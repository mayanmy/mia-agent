import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { createPageResult, normalizePageQuery } from "../../core/pagination";
import { PageResult } from "../../core/result";
import { PrismaService } from "../prisma/prisma.service";
import { ToolCallLogListItem, ToolCallLogQueryDto } from "./dto/log.dto";

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const where: Prisma.ToolCallLogWhereInput = {};

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
