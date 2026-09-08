import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { requireWorkspaceId } from "../../core/auth/workspace-context";
import { createPageResult, normalizePageQuery } from "../../core/pagination";
import { PageResult } from "../../core/result";
import { PrismaService } from "../prisma/prisma.service";
import { ToolCallLogListItem, ToolCallLogQueryDto } from "./dto/log.dto";

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

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
