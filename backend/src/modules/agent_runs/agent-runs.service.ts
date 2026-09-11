import { HttpStatus, Injectable } from "@nestjs/common";
import { AgentRun, AgentRunStatus, AgentRunStepStatus, Prisma, PrismaClient } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { requireWorkspaceId } from "../../core/auth/workspace-context";
import { createPageResult, normalizePageQuery } from "../../core/pagination";
import { PageResult } from "../../core/result";
import { PrismaService } from "../prisma/prisma.service";
import {
  AgentRunContext,
  AgentRunErrorDto,
  CompleteAgentRunDto,
  CreateAgentRunDto
} from "./dto/agent-run.dto";
import {
  AgentRunStepContext,
  StartAgentRunStepDto,
  TraceJsonValue
} from "./dto/agent-run-step.dto";
import {
  AgentRunDetail,
  AgentRunListItem,
  AgentRunQueryDto,
  CleanupAgentRunsResult
} from "./dto/agent-run-query.dto";

const INPUT_PREVIEW_LIMIT = 2_000;
const OUTPUT_PREVIEW_LIMIT = 4_000;
const ERROR_MESSAGE_LIMIT = 2_000;
const TRACE_STRING_LIMIT = 8_000;
const TRACE_JSON_LIMIT = 32 * 1024;
const TRACE_OVERSIZE_PREVIEW_LIMIT = 12_000;
const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_KEY_PATTERN =
  /^(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|token|cookie|set-cookie|password|secret)$/i;
const BINARY_CONTENT_KEY_PATTERN = /^(data[-_]?url|file[-_]?content|image[-_]?content)$/i;

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

@Injectable()
export class AgentRunsService {
  /** 注入 Prisma；所有 Run Trace 表只允许由本服务直接写入。 */
  constructor(private readonly prisma: PrismaService) {}

  /** 查询 Run 列表，所有筛选均在数据库执行并限制最大分页大小。 */
  async listRuns(query: AgentRunQueryDto): Promise<PageResult<AgentRunListItem>> {
    const page = normalizePageQuery(query);
    const where = this.buildRunWhere(query);
    const [runs, total] = await Promise.all([
      this.prisma.agentRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
        include: { _count: { select: { steps: true } } }
      }),
      this.prisma.agentRun.count({ where })
    ]);

    return createPageResult(
      runs.map((run) => ({ ...this.toRunListItem(run), stepCount: run._count.steps })),
      total,
      page.page,
      page.pageSize
    );
  }

  /** 查询 Run 详情并按 sequence 返回 Timeline；不存在时返回稳定的 404 错误。 */
  async getRunDetail(runId: string): Promise<AgentRunDetail> {
    const run = await this.prisma.agentRun.findFirst({
      where: {
        id: this.requireText(runId, "runId"),
        workspaceId: requireWorkspaceId()
      },
      include: { steps: { orderBy: { sequence: "asc" } } }
    });

    if (!run) {
      throw new AppError(ErrorCodes.agentRun.notFound, "Agent Run 不存在", HttpStatus.NOT_FOUND);
    }

    return {
      ...this.toRunListItem(run),
      stepCount: run.steps.length,
      externalConversationId: run.externalConversationId,
      estimatedCost: run.estimatedCost?.toString() ?? null,
      updatedAt: run.updatedAt,
      steps: run.steps.map((step) => ({
        id: step.id,
        sequence: step.sequence,
        type: step.type,
        name: step.name,
        nodeId: step.nodeId,
        attempt: step.attempt,
        status: step.status,
        input: step.input,
        output: step.output,
        elapsedMs: step.elapsedMs,
        errorType: step.errorType,
        errorMessage: step.errorMessage,
        startedAt: step.startedAt,
        finishedAt: step.finishedAt
      }))
    };
  }

  /**
   * 清理过期 Trace：成功/取消 Run 使用普通保留期，失败/超时 Run 使用更长保留期。
   * ToolCallLog 没有外键，因此必须与 Run 在同一事务中显式删除，并清理过期孤立日志。
   */
  async cleanupExpiredRuns(
    completedRetentionDays = 90,
    failedRetentionDays = 180
  ): Promise<CleanupAgentRunsResult> {
    const completedDays = this.requireRetentionDays(
      completedRetentionDays,
      "completedRetentionDays"
    );
    const failedDays = this.requireRetentionDays(failedRetentionDays, "failedRetentionDays");
    const completedCutoff = new Date(Date.now() - completedDays * 86_400_000);
    const failedCutoff = new Date(Date.now() - failedDays * 86_400_000);
    const rows = await this.prisma.$queryRaw<
      Array<{ deleted_runs: bigint; deleted_tool_logs: bigint }>
    >(
      Prisma.sql`
        WITH expired_runs AS (
          SELECT id
          FROM agent_runs
          WHERE
            (status IN ('COMPLETED', 'CANCELED') AND created_at < ${completedCutoff})
            OR (status IN ('FAILED', 'TIMED_OUT') AND created_at < ${failedCutoff})
        ), deleted_logs AS (
          DELETE FROM tool_call_logs
          WHERE run_id IN (SELECT id FROM expired_runs)
             OR (run_id IS NULL AND created_at < ${completedCutoff})
          RETURNING id
        ), deleted_runs AS (
          DELETE FROM agent_runs
          WHERE id IN (SELECT id FROM expired_runs)
          RETURNING id
        )
        SELECT
          (SELECT COUNT(*) FROM deleted_runs) AS deleted_runs,
          (SELECT COUNT(*) FROM deleted_logs) AS deleted_tool_logs
      `
    );

    return {
      completedCutoff,
      failedCutoff,
      deletedRuns: Number(rows[0]?.deleted_runs ?? 0),
      deletedToolCallLogs: Number(rows[0]?.deleted_tool_logs ?? 0)
    };
  }

  /** 创建排队态 Run，并在入口处截断用户输入，避免 Trace 表保存无限长度内容。 */
  async createRun(payload: CreateAgentRunDto): Promise<AgentRunContext> {
    const agentId = this.optionalText(payload.agentId);
    // 公开 Agent 入口可能没有 Workspace Context，因此仍从 Agent 归属解析空间；
    // 独立 Workflow 入口则由已鉴权的请求上下文提供空间，避免跨模块查询 Workflow 表。
    const workspaceId = agentId
      ? (
          await this.prisma.agent.findUniqueOrThrow({
            where: { id: agentId },
            select: { workspaceId: true }
          })
        ).workspaceId
      : requireWorkspaceId();
    if (!agentId && !this.optionalText(payload.workflowId)) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "无 Agent 的 Run 必须关联 Workflow",
        HttpStatus.BAD_REQUEST
      );
    }
    const run = await this.prisma.agentRun.create({
      data: {
        workspaceId,
        requestId: this.requireText(payload.requestId, "requestId"),
        source: payload.source,
        agentId,
        userId: this.optionalText(payload.userId),
        sessionId: this.optionalText(payload.sessionId),
        externalConversationId: this.optionalText(payload.externalConversationId),
        workflowId: this.optionalText(payload.workflowId),
        workflowVersionId: this.optionalText(payload.workflowVersionId),
        workflowRunMode: payload.workflowRunMode,
        inputPreview: this.truncate(payload.inputPreview, INPUT_PREVIEW_LIMIT)
      },
      select: {
        id: true,
        requestId: true,
        status: true
      }
    });

    return {
      runId: run.id,
      requestId: run.requestId,
      status: run.status
    };
  }

  /** 将 Run 从排队态切换到运行态；条件更新防止重复启动或覆盖终态。 */
  async startRun(runId: string, modelConfigId?: string): Promise<void> {
    const result = await this.prisma.agentRun.updateMany({
      where: {
        id: this.requireText(runId, "runId"),
        status: AgentRunStatus.QUEUED
      },
      data: {
        status: AgentRunStatus.RUNNING,
        startedAt: new Date(),
        modelConfigId: this.optionalText(modelConfigId)
      }
    });

    this.assertTransitioned(result.count, "Run 只能从 QUEUED 进入 RUNNING");
  }

  /** 仅记录第一次 Token 到达时间；重复 Token 不会覆盖首 Token 指标。 */
  async markFirstToken(runId: string): Promise<void> {
    await this.prisma.agentRun.updateMany({
      where: {
        id: this.requireText(runId, "runId"),
        status: AgentRunStatus.RUNNING,
        firstTokenAt: null
      },
      data: {
        firstTokenAt: new Date()
      }
    });
  }

  /** 将当前 Tool Step 与 Run 一起挂起，审批期间不允许其他 Step 并发推进。 */
  async waitForApproval(runId: string, stepId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const step = await transaction.agentRunStep.updateMany({
        where: { id: stepId, runId, status: AgentRunStepStatus.RUNNING },
        data: { status: AgentRunStepStatus.WAITING_APPROVAL }
      });
      const run = await transaction.agentRun.updateMany({
        where: { id: runId, status: AgentRunStatus.RUNNING },
        data: { status: AgentRunStatus.WAITING_APPROVAL }
      });
      this.assertTransitioned(step.count, "只有运行中的 Tool Step 可以等待审批");
      this.assertTransitioned(run.count, "只有运行中的 Run 可以等待审批");
    });
  }

  /** 审批作出决定后恢复同一个 Run/Step；后续完成或失败仍使用原 Trace 标识。 */
  async resumeAfterApproval(runId: string, stepId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const run = await transaction.agentRun.updateMany({
        where: { id: runId, status: AgentRunStatus.WAITING_APPROVAL },
        data: { status: AgentRunStatus.RUNNING }
      });
      const step = await transaction.agentRunStep.updateMany({
        where: { id: stepId, runId, status: AgentRunStepStatus.WAITING_APPROVAL },
        data: { status: AgentRunStepStatus.RUNNING }
      });
      this.assertTransitioned(run.count, "等待审批的 Run 无法恢复");
      this.assertTransitioned(step.count, "等待审批的 Tool Step 无法恢复");
    });
  }

  /** 完成运行中的 Run，并在同一事务内收敛意外遗留的活动 Step。 */
  async completeRun(runId: string, payload: CompleteAgentRunDto): Promise<void> {
    await this.finishRun(runId, AgentRunStatus.COMPLETED, AgentRunStepStatus.SKIPPED, {
      outputPreview: this.truncate(payload.outputPreview, OUTPUT_PREVIEW_LIMIT),
      inputTokens: this.optionalNonNegativeInteger(payload.inputTokens, "inputTokens"),
      outputTokens: this.optionalNonNegativeInteger(payload.outputTokens, "outputTokens"),
      estimatedCost: this.optionalNonNegativeNumber(payload.estimatedCost, "estimatedCost")
    });
  }

  /** 将运行中的 Run 标记失败，并保存可控长度的错误分类和消息。 */
  async failRun(runId: string, error: AgentRunErrorDto): Promise<void> {
    await this.finishRun(
      runId,
      AgentRunStatus.FAILED,
      AgentRunStepStatus.FAILED,
      {
        errorType: this.requireText(error.type, "error.type"),
        errorMessage: this.truncate(error.message, ERROR_MESSAGE_LIMIT)
      },
      [AgentRunStatus.RUNNING, AgentRunStatus.WAITING_APPROVAL]
    );
  }

  /** 将排队中或运行中的 Run 标记取消，覆盖用户在模型启动前取消的场景。 */
  async cancelRun(runId: string): Promise<void> {
    await this.finishRun(runId, AgentRunStatus.CANCELED, AgentRunStepStatus.CANCELED, {}, [
      AgentRunStatus.QUEUED,
      AgentRunStatus.RUNNING,
      AgentRunStatus.WAITING_APPROVAL
    ]);
  }

  /** 将运行中的 Run 标记总超时，并把活动 Step 收敛为失败。 */
  async timeoutRun(runId: string): Promise<void> {
    await this.finishRun(
      runId,
      AgentRunStatus.TIMED_OUT,
      AgentRunStepStatus.FAILED,
      {
        errorType: "run_timeout",
        errorMessage: "Agent Run 执行超时"
      },
      [AgentRunStatus.RUNNING, AgentRunStatus.WAITING_APPROVAL]
    );
  }

  /** 为运行中的 Run 创建一个有序 Step，并在写库前递归脱敏输入。 */
  async startStep(payload: StartAgentRunStepDto): Promise<AgentRunStepContext> {
    if (!Number.isInteger(payload.sequence) || payload.sequence < 1) {
      throw new AppError(ErrorCodes.common.badRequest, "sequence 必须是正整数");
    }

    return this.prisma.$transaction(async (transaction) => {
      const run = await transaction.agentRun.findFirst({
        where: {
          id: this.requireText(payload.runId, "runId"),
          status: AgentRunStatus.RUNNING
        },
        select: { id: true }
      });

      if (!run) {
        throw this.invalidState("只有 RUNNING 状态的 Run 可以创建 Step");
      }

      const step = await transaction.agentRunStep.create({
        data: {
          runId: run.id,
          sequence: payload.sequence,
          type: payload.type,
          name: this.requireText(payload.name, "name"),
          nodeId: this.optionalText(payload.nodeId),
          attempt: this.optionalPositiveInteger(payload.attempt, "attempt") ?? 1,
          input: this.toPrismaJson(payload.input)
        },
        select: {
          id: true,
          runId: true,
          sequence: true,
          startedAt: true
        }
      });

      return {
        stepId: step.id,
        runId: step.runId,
        sequence: step.sequence,
        startedAt: step.startedAt
      };
    });
  }

  /** 完成活动 Step，输出会先脱敏和限制序列化体积。 */
  async completeStep(stepId: string, output?: TraceJsonValue): Promise<void> {
    await this.finishStep(stepId, AgentRunStepStatus.COMPLETED, {
      output: this.toPrismaJson(output)
    });
  }

  /** 将活动 Step 标记失败，并保留标准错误类型供统计聚合。 */
  async failStep(stepId: string, error: AgentRunErrorDto): Promise<void> {
    await this.finishStep(stepId, AgentRunStepStatus.FAILED, {
      errorType: this.requireText(error.type, "error.type"),
      errorMessage: this.truncate(error.message, ERROR_MESSAGE_LIMIT)
    });
  }

  /** 将活动 Step 标记取消，用于客户端断开和用户主动停止。 */
  async cancelStep(stepId: string): Promise<void> {
    await this.finishStep(stepId, AgentRunStepStatus.CANCELED, {});
  }

  /** 跳过不再需要执行的活动 Step，并把原因作为脱敏输出保存。 */
  async skipStep(stepId: string, reason: string): Promise<void> {
    await this.finishStep(stepId, AgentRunStepStatus.SKIPPED, {
      output: this.toPrismaJson({ reason })
    });
  }

  /** 在事务内完成 Run 和遗留 Step，保证顶层状态与时间线不会出现互相矛盾的结果。 */
  private async finishRun(
    runId: string,
    status: AgentRunStatus,
    activeStepStatus: AgentRunStepStatus,
    data: Prisma.AgentRunUpdateManyMutationInput,
    allowedStatuses: AgentRunStatus[] = [AgentRunStatus.RUNNING]
  ): Promise<void> {
    const normalizedRunId = this.requireText(runId, "runId");
    const finishedAt = new Date();

    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.agentRun.updateMany({
        where: {
          id: normalizedRunId,
          status: { in: allowedStatuses }
        },
        data: {
          ...data,
          status,
          finishedAt
        }
      });

      this.assertTransitioned(result.count, `Run 无法进入 ${status}`);

      await transaction.agentRunStep.updateMany({
        where: {
          runId: normalizedRunId,
          status: { in: [AgentRunStepStatus.RUNNING, AgentRunStepStatus.WAITING_APPROVAL] }
        },
        data: {
          status: activeStepStatus,
          finishedAt,
          ...(activeStepStatus === AgentRunStepStatus.FAILED
            ? {
                errorType: typeof data.errorType === "string" ? data.errorType : "run_failed",
                errorMessage:
                  typeof data.errorMessage === "string"
                    ? data.errorMessage
                    : "Run 已结束，活动 Step 被自动收敛"
              }
            : {})
        }
      });
    });
  }

  /** 完成单个 Step，并根据 startedAt 计算稳定的非负耗时。 */
  private async finishStep(
    stepId: string,
    status: AgentRunStepStatus,
    data: Prisma.AgentRunStepUpdateManyMutationInput
  ): Promise<void> {
    const normalizedStepId = this.requireText(stepId, "stepId");

    await this.prisma.$transaction(async (transaction: TransactionClient) => {
      const step = await transaction.agentRunStep.findFirst({
        where: {
          id: normalizedStepId,
          status: AgentRunStepStatus.RUNNING
        },
        select: { startedAt: true }
      });

      if (!step) {
        throw this.invalidState("只有 RUNNING 状态的 Step 可以结束");
      }

      const finishedAt = new Date();
      const result = await transaction.agentRunStep.updateMany({
        where: {
          id: normalizedStepId,
          status: AgentRunStepStatus.RUNNING
        },
        data: {
          ...data,
          status,
          elapsedMs: Math.max(0, finishedAt.getTime() - step.startedAt.getTime()),
          finishedAt
        }
      });

      this.assertTransitioned(result.count, `Step 无法进入 ${status}`);
    });
  }

  /** 把 Trace 值转换为 Prisma JSON，并在递归脱敏后执行整体大小限制。 */
  private toPrismaJson(
    value: TraceJsonValue | undefined
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return Prisma.JsonNull;
    }

    const sanitized = this.sanitizeTraceValue(value);
    const serialized = JSON.stringify(sanitized);

    if (serialized.length <= TRACE_JSON_LIMIT) {
      return sanitized as Prisma.InputJsonValue;
    }

    return {
      truncated: true,
      preview: serialized.slice(0, TRACE_OVERSIZE_PREVIEW_LIMIT)
    };
  }

  /** 递归清理敏感键、二进制内容和超长字符串，数组结构保持不变便于排障。 */
  private sanitizeTraceValue(value: TraceJsonValue): TraceJsonValue {
    if (typeof value === "string") {
      return this.truncate(value, TRACE_STRING_LIMIT);
    }

    if (value === null || typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeTraceValue(item));
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (SENSITIVE_KEY_PATTERN.test(key) || BINARY_CONTENT_KEY_PATTERN.test(key)) {
          return [key, REDACTED_VALUE];
        }

        return [key, this.sanitizeTraceValue(item)];
      })
    );
  }

  /** 将 Run 查询条件收敛到稳定字段，避免 Controller 或前端拼接 Prisma 条件。 */
  private buildRunWhere(query: AgentRunQueryDto): Prisma.AgentRunWhereInput {
    const where: Prisma.AgentRunWhereInput = { workspaceId: requireWorkspaceId() };
    if (query.requestId?.trim()) where.requestId = query.requestId.trim();
    if (query.agentId?.trim()) where.agentId = query.agentId.trim();
    if (query.userId?.trim()) where.userId = query.userId.trim();
    if (query.workflowId?.trim()) where.workflowId = query.workflowId.trim();
    if (query.workflowVersionId?.trim()) {
      where.workflowVersionId = query.workflowVersionId.trim();
    }
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    const createdFrom = this.parseDate(query.createdFrom, "createdFrom");
    const createdTo = this.parseDate(query.createdTo, "createdTo");
    if (createdFrom || createdTo) {
      where.createdAt = {
        ...(createdFrom ? { gte: createdFrom } : {}),
        ...(createdTo ? { lte: createdTo } : {})
      };
    }
    return where;
  }

  /** 将 Prisma Run 映射为管理端 DTO，不把 ORM Relation 和 Decimal 对象泄漏给调用方。 */
  private toRunListItem(run: AgentRun): Omit<AgentRunListItem, "stepCount"> {
    return {
      id: run.id,
      requestId: run.requestId,
      source: run.source,
      status: run.status,
      agentId: run.agentId,
      userId: run.userId,
      sessionId: run.sessionId,
      modelConfigId: run.modelConfigId,
      workflowId: run.workflowId,
      workflowVersionId: run.workflowVersionId,
      workflowRunMode: run.workflowRunMode,
      inputPreview: run.inputPreview,
      outputPreview: run.outputPreview,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      firstTokenAt: run.firstTokenAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      errorType: run.errorType,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt
    };
  }

  /** 解析 ISO 时间筛选，拒绝无效日期，避免查询静默返回错误范围。 */
  private parseDate(value: string | undefined, fieldName: string): Date | undefined {
    if (!value?.trim()) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new AppError(ErrorCodes.common.badRequest, `${fieldName} 无效`);
    }
    return date;
  }

  /** 校验清理保留天数，限制在 1-3650 天，避免参数错误清空全部 Trace。 */
  private requireRetentionDays(value: number, fieldName: string): number {
    if (!Number.isInteger(value) || value < 1 || value > 3650) {
      throw new AppError(ErrorCodes.common.badRequest, `${fieldName} 必须是 1-3650 的整数`);
    }
    return value;
  }

  /** 校验必填字符串并去除首尾空白，阻止空追踪键进入数据库。 */
  private requireText(value: string, fieldName: string): string {
    const normalized = typeof value === "string" ? value.trim() : "";

    if (!normalized) {
      throw new AppError(ErrorCodes.common.badRequest, `${fieldName} 不能为空`);
    }

    return normalized;
  }

  /** 规范可选字符串，空字符串按未提供处理。 */
  private optionalText(value: string | undefined): string | undefined {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized || undefined;
  }

  /** 校验可选 Token 数，防止负数和小数污染用量统计。 */
  private optionalNonNegativeInteger(value: number | undefined, fieldName: string) {
    if (value === undefined) {
      return undefined;
    }

    if (!Number.isInteger(value) || value < 0) {
      throw new AppError(ErrorCodes.common.badRequest, `${fieldName} 必须是非负整数`);
    }

    return value;
  }

  /** Workflow 节点重试次数从 1 开始，普通 Agent Step 未提供时仍保持首次执行。 */
  private optionalPositiveInteger(value: number | undefined, fieldName: string) {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || value < 1) {
      throw new AppError(ErrorCodes.common.badRequest, `${fieldName} 必须是正整数`);
    }
    return value;
  }

  /** 校验可选成本值，成本只允许有限非负数。 */
  private optionalNonNegativeNumber(value: number | undefined, fieldName: string) {
    if (value === undefined) {
      return undefined;
    }

    if (!Number.isFinite(value) || value < 0) {
      throw new AppError(ErrorCodes.common.badRequest, `${fieldName} 必须是非负数`);
    }

    return value;
  }

  /** 按字符数截断 Trace 文本，保留明确标记以提示内容并不完整。 */
  private truncate(value: string, limit: number): string {
    const normalized = typeof value === "string" ? value : "";
    return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}...[truncated]`;
  }

  /** 条件更新未命中时抛出状态冲突，避免调用方误以为状态已经写入。 */
  private assertTransitioned(count: number, message: string): void {
    if (count !== 1) {
      throw this.invalidState(message);
    }
  }

  /** 创建统一的 Run 状态冲突异常，Controller 后续可稳定映射为 HTTP 409。 */
  private invalidState(message: string): AppError {
    return new AppError(ErrorCodes.agentRun.invalidState, message, HttpStatus.CONFLICT);
  }
}
