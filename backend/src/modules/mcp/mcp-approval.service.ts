import { createHash } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import { McpApprovalMode, McpToolApprovalStatus } from "@prisma/client";

import { encryptSecret } from "../../core/crypto";
import { requireWorkspaceId } from "../../core/auth/workspace-context";
import { AppError, ErrorCodes } from "../../core/errors";
import { PrismaService } from "../prisma/prisma.service";
import {
  McpToolApprovalConsumeRequest,
  McpToolApprovalCreateRequest,
  McpToolApprovalDecision,
  McpToolApprovalDetail
} from "./dto/mcp-approval.dto";

const APPROVAL_TTL_MS = 5 * 60 * 1_000;

type ApprovalWaiter = {
  resolve: (decision: McpToolApprovalDecision) => void;
  timer: NodeJS.Timeout;
  abort?: () => void;
  signal?: AbortSignal;
};

@Injectable()
export class McpApprovalService {
  private readonly waiters = new Map<string, ApprovalWaiter>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建一次性审批请求。输入密文只用于审计恢复，inputHash 才参与消费校验，避免明文泄漏。
   */
  async createRequest(request: McpToolApprovalCreateRequest): Promise<McpToolApprovalDetail> {
    const tool = await this.prisma.mcpServerTool.findUnique({
      where: { runtimeId: request.runtimeId },
      include: { server: { select: { approvalMode: true, enabled: true, deletedAt: true } } }
    });
    if (!tool || !tool.enabled || !tool.server.enabled || tool.server.deletedAt) {
      throw new AppError(
        ErrorCodes.mcp.toolNotFound,
        "MCP Tool 不存在或已停用",
        HttpStatus.NOT_FOUND
      );
    }
    const mode = tool.approvalMode ?? tool.server.approvalMode;
    if (mode !== McpApprovalMode.CONFIRM) {
      throw new AppError(
        ErrorCodes.common.conflict,
        "当前 MCP Tool 不需要人工审批",
        HttpStatus.CONFLICT
      );
    }

    const serializedInput = this.stableJson(request.input);
    const approval = await this.prisma.mcpToolApproval.create({
      data: {
        workspaceId: tool.workspaceId,
        serverId: tool.serverId,
        toolId: tool.id,
        runtimeId: tool.runtimeId,
        runId: request.runId,
        stepId: request.stepId,
        toolCallId: request.toolCallId,
        requestId: request.requestId,
        userId: request.userId,
        agentId: request.agentId,
        encryptedInput: encryptSecret(serializedInput),
        inputHash: this.hash(serializedInput),
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MS)
      }
    });
    return this.toDetail(approval);
  }

  /** 等待 Controller 写入决定；SSE 会继续发送心跳，因此短时等待不会变成静默死连接。 */
  async waitForDecision(
    approvalId: string,
    signal?: AbortSignal
  ): Promise<McpToolApprovalDecision> {
    const current = await this.prisma.mcpToolApproval.findUnique({ where: { id: approvalId } });
    if (!current)
      throw new AppError(ErrorCodes.mcp.notFound, "工具审批不存在", HttpStatus.NOT_FOUND);
    if (current.status !== McpToolApprovalStatus.PENDING) return this.toDecision(current.status);
    if (current.expiresAt.getTime() <= Date.now()) {
      await this.transition(approvalId, McpToolApprovalStatus.EXPIRED);
      return { approved: false, status: "EXPIRED" };
    }

    return new Promise<McpToolApprovalDecision>((resolve) => {
      const remainingMs = Math.max(1, current.expiresAt.getTime() - Date.now());
      const timer = setTimeout(() => {
        void this.transition(approvalId, McpToolApprovalStatus.EXPIRED);
        this.resolveWaiter(approvalId, { approved: false, status: "EXPIRED" });
      }, remainingMs);
      timer.unref();
      const abort = signal
        ? () => {
            void this.transition(approvalId, McpToolApprovalStatus.CANCELED);
            this.resolveWaiter(approvalId, { approved: false, status: "CANCELED" });
          }
        : undefined;
      if (signal?.aborted) {
        clearTimeout(timer);
        void this.transition(approvalId, McpToolApprovalStatus.CANCELED);
        resolve({ approved: false, status: "CANCELED" });
        return;
      }
      if (abort) signal?.addEventListener("abort", abort, { once: true });
      this.waiters.set(approvalId, { resolve, timer, abort, signal });
    });
  }

  async approve(approvalId: string, userId: string): Promise<McpToolApprovalDetail> {
    return this.decide(approvalId, userId, McpToolApprovalStatus.APPROVED);
  }

  async reject(approvalId: string, userId: string): Promise<McpToolApprovalDetail> {
    return this.decide(approvalId, userId, McpToolApprovalStatus.REJECTED);
  }

  /**
   * 执行前原子消费批准记录。只有原用户、原 Agent、原 Run、原工具和原参数全部一致才放行一次。
   */
  async consume(request: McpToolApprovalConsumeRequest): Promise<void> {
    const serializedInput = this.stableJson(request.input);
    const result = await this.prisma.mcpToolApproval.updateMany({
      where: {
        id: request.approvalId,
        runtimeId: request.runtimeId,
        runId: request.runId,
        userId: request.userId,
        agentId: request.agentId,
        inputHash: this.hash(serializedInput),
        status: McpToolApprovalStatus.APPROVED,
        expiresAt: { gt: new Date() }
      },
      data: { status: McpToolApprovalStatus.CONSUMED, consumedAt: new Date() }
    });
    if (result.count !== 1) {
      throw new AppError(
        ErrorCodes.common.forbidden,
        "工具审批无效、已过期或已被消费",
        HttpStatus.FORBIDDEN
      );
    }
  }

  private async decide(
    approvalId: string,
    userId: string,
    status: "APPROVED" | "REJECTED"
  ): Promise<McpToolApprovalDetail> {
    const approval = await this.prisma.mcpToolApproval.findFirst({
      where: { id: approvalId, workspaceId: requireWorkspaceId(), userId }
    });
    if (!approval)
      throw new AppError(ErrorCodes.mcp.notFound, "工具审批不存在", HttpStatus.NOT_FOUND);
    if (approval.expiresAt.getTime() <= Date.now()) {
      await this.transition(approvalId, McpToolApprovalStatus.EXPIRED);
      throw new AppError(ErrorCodes.common.conflict, "工具审批已过期", HttpStatus.CONFLICT);
    }
    const changed = await this.prisma.mcpToolApproval.updateMany({
      where: {
        id: approvalId,
        workspaceId: requireWorkspaceId(),
        userId,
        status: McpToolApprovalStatus.PENDING
      },
      data: { status, decidedAt: new Date() }
    });
    if (changed.count !== 1) {
      throw new AppError(ErrorCodes.common.conflict, "工具审批已处理", HttpStatus.CONFLICT);
    }
    this.resolveWaiter(approvalId, this.toDecision(status));
    return this.toDetail({ ...approval, status });
  }

  private async transition(id: string, status: McpToolApprovalStatus): Promise<void> {
    await this.prisma.mcpToolApproval.updateMany({
      where: { id, status: McpToolApprovalStatus.PENDING },
      data: { status, decidedAt: new Date() }
    });
  }

  private resolveWaiter(id: string, decision: McpToolApprovalDecision): void {
    const waiter = this.waiters.get(id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    if (waiter.abort) waiter.signal?.removeEventListener("abort", waiter.abort);
    this.waiters.delete(id);
    waiter.resolve(decision);
  }

  private toDecision(status: McpToolApprovalStatus): McpToolApprovalDecision {
    return { approved: status === McpToolApprovalStatus.APPROVED, status };
  }

  private toDetail(approval: {
    id: string;
    runtimeId: string;
    runId: string;
    toolCallId: string | null;
    status: McpToolApprovalStatus;
    expiresAt: Date;
  }): McpToolApprovalDetail {
    return {
      id: approval.id,
      runtimeId: approval.runtimeId,
      runId: approval.runId,
      toolCallId: approval.toolCallId ?? undefined,
      status: approval.status,
      expiresAt: approval.expiresAt.toISOString()
    };
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.stableJson(item)).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableJson(item)}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  }
}
