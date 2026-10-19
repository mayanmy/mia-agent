import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { requireWorkspaceId } from "../../core/auth/workspace-context";
import { createPageResult, normalizePageQuery } from "../../core/pagination";
import { PageResult } from "../../core/result";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateRagTraceDto,
  LogEventDto,
  RagTraceQueryDto,
  ToolCallLogListItem,
  ToolCallLogQueryDto
} from "./dto/log.dto";

const RAG_TRACE_RETENTION_DAYS = 90;

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 保存在线回答的不可变 Trace；调用方负责以弱依赖方式处理写入失败。 */
  async createRagTrace(payload: CreateRagTraceDto) {
    const expiresAt = new Date(Date.now() + RAG_TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    return this.prisma.ragTrace.create({
      data: {
        workspaceId: requireWorkspaceId(),
        ...payload,
        agentConfigSnapshot: payload.agentConfigSnapshot as Prisma.InputJsonValue,
        retrievalConfigSnapshot: payload.retrievalConfigSnapshot as Prisma.InputJsonValue,
        candidateChunks: payload.candidateChunks as Prisma.InputJsonValue,
        selectedChunks: payload.selectedChunks as Prisma.InputJsonValue,
        modelConfigSnapshot: payload.modelConfigSnapshot as Prisma.InputJsonValue,
        citations: payload.citations as Prisma.InputJsonValue,
        tokenUsage: payload.tokenUsage as Prisma.InputJsonValue | undefined,
        error: payload.error as Prisma.InputJsonValue | undefined,
        expiresAt
      }
    });
  }

  /** 管理端分页查询 Trace，正文快照仅在具备管理权限的接口中返回。 */
  async listRagTraces(query: RagTraceQueryDto) {
    const page = normalizePageQuery(query);
    const where: Prisma.RagTraceWhereInput = {
      workspaceId: requireWorkspaceId(),
      ...(query.requestId?.trim() ? { requestId: query.requestId.trim() } : {}),
      ...(query.messageId?.trim() ? { messageId: query.messageId.trim() } : {}),
      ...(query.agentId?.trim() ? { agentId: query.agentId.trim() } : {}),
      ...(query.status ? { status: query.status } : {})
    };
    const createdFrom = this.parseDate(query.createdFrom, "createdFrom");
    const createdTo = this.parseDate(query.createdTo, "createdTo");
    if (createdFrom || createdTo) {
      where.createdAt = {
        ...(createdFrom ? { gte: createdFrom } : {}),
        ...(createdTo ? { lte: createdTo } : {})
      };
    }
    const [list, total] = await Promise.all([
      this.prisma.ragTrace.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take
      }),
      this.prisma.ragTrace.count({ where })
    ]);
    return createPageResult(list, total, page.page, page.pageSize);
  }

  async recordEvent(event: LogEventDto): Promise<void> {
    await this.prisma.logEvent.create({
      data: {
        workspaceId: requireWorkspaceId(),
        ...event,
        payload: event.payload as Prisma.InputJsonValue | undefined
      }
    });
  }

  /** 供定时维护任务调用；正式评估数据不存于本表，因此可按保留期直接清理。 */
  async deleteExpiredRagTraces(now = new Date()): Promise<number> {
    const result = await this.prisma.ragTrace.deleteMany({ where: { expiresAt: { lte: now } } });
    return result.count;
  }

  /** 并行读取当前页和总数，二者复用同一筛选条件避免口径漂移。 */
  async listToolCallLogs(query: ToolCallLogQueryDto): Promise<PageResult<ToolCallLogListItem>> {
    const page = normalizePageQuery(query);
    const where = this.buildToolCallLogWhere(query);

    const [list, total] = await Promise.all([
      this.prisma.toolCallLog.findMany({
        where,
        orderBy: {
          createdAt: "desc"
        },
        skip: page.skip,
        take: page.take
      }),
      this.prisma.toolCallLog.count({ where })
    ]);

    return createPageResult(list, total, page.page, page.pageSize);
  }

  private buildToolCallLogWhere(query: ToolCallLogQueryDto): Prisma.ToolCallLogWhereInput {
    const where: Prisma.ToolCallLogWhereInput = { workspaceId: requireWorkspaceId() };

    if (query.requestId?.trim()) {
      where.requestId = query.requestId.trim();
    }

    if (query.agentId?.trim()) {
      where.agentId = query.agentId.trim();
    }

    if (query.toolId?.trim()) {
      where.toolId = query.toolId.trim();
    }

    if (query.status?.trim()) {
      where.status = query.status.trim();
    }

    const createdFrom = this.parseDate(query.createdFrom, "createdFrom");
    const createdTo = this.parseDate(query.createdTo, "createdTo");

    // 只有至少一个有效边界时才生成 createdAt 条件，避免空对象影响 Prisma 查询语义。
    if (createdFrom || createdTo) {
      where.createdAt = {
        ...(createdFrom ? { gte: createdFrom } : {}),
        ...(createdTo ? { lte: createdTo } : {})
      };
    }

    return where;
  }

  private parseDate(value: string | undefined, fieldName: string): Date | undefined {
    if (!value?.trim()) {
      return undefined;
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new AppError(ErrorCodes.common.badRequest, `${fieldName} is invalid`);
    }

    return parsed;
  }
}
