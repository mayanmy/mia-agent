import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import {
  ToolCallLogRecord,
  ToolDefinition,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolJsonValue,
  ToolListItem
} from "./dto/tool.dto";
import { getBuiltinTool, getBuiltinToolDefinitions, listEnabledBuiltinTools } from "./registry";

@Injectable()
export class ToolsService {
  constructor(@Optional() private readonly prismaService?: PrismaService) {}

  listTools(): ToolListItem[] {
    return listEnabledBuiltinTools().map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      enabled: tool.enabled
    }));
  }

  getToolDefinitions(toolIds: string[]): ToolDefinition[] {
    const normalizedToolIds = this.normalizeToolIds(toolIds);
    return getBuiltinToolDefinitions(normalizedToolIds);
  }

  async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const startedAt = Date.now();
    const toolId = this.normalizeToolId(request.toolId);
    const tool = getBuiltinTool(toolId);

    if (!tool || !tool.enabled) {
      const result = this.toFailureResult(
        toolId,
        "tool_not_found",
        "工具不存在或已停用",
        startedAt
      );
      await this.recordExecutionResult({ request, toolId, result });
      return result;
    }

    try {
      const output = await tool.execute(this.normalizeInput(request.input), {
        requestId: request.requestId,
        userId: request.userId,
        agentId: request.agentId,
        signal: request.signal
      });

      const result: ToolExecutionResult = {
        toolId,
        ok: true,
        output,
        elapsedMs: Date.now() - startedAt
      };
      await this.recordExecutionResult({ request, toolId, result });
      return result;
    } catch (error) {
      const result = this.toFailureResult(
        toolId,
        this.getErrorType(error),
        this.getErrorMessage(error),
        startedAt
      );
      await this.recordExecutionResult({ request, toolId, result });
      return result;
    }
  }

  async recordToolCallLog(record: ToolCallLogRecord): Promise<void> {
    if (!this.prismaService) {
      return;
    }

    try {
      await this.prismaService.$executeRaw(
        Prisma.sql`
          INSERT INTO "tool_call_logs" (
            "request_id",
            "agent_id",
            "user_id",
            "tool_call_id",
            "tool_id",
            "status",
            "source",
            "reason",
            "input",
            "output",
            "error_type",
            "error_message",
            "elapsed_ms"
          )
          VALUES (
            ${record.requestId ?? null},
            ${record.agentId ?? null},
            ${record.userId ?? null},
            ${record.toolCallId ?? null},
            ${record.toolId ?? null},
            ${record.status},
            ${record.source ?? null},
            ${record.reason ?? null},
            ${this.toJsonSql(record.input)},
            ${this.toJsonSql(record.output)},
            ${record.errorType ?? null},
            ${record.errorMessage ?? null},
            ${record.elapsedMs ?? null}
          )
        `
      );
    } catch {
      // Tool logs are diagnostic only; logging failures must not break chat generation.
    }
  }

  private async recordExecutionResult(request: {
    request: ToolExecutionRequest;
    toolId: string;
    result: ToolExecutionResult;
  }): Promise<Record<string, never>> {
    // Keep execution outcome logging in ToolsService so every caller gets the same
    // completed/failed record, including non-chat callers and missing-tool failures.
    await this.recordToolCallLog({
      requestId: request.request.requestId,
      userId: request.request.userId,
      agentId: request.request.agentId,
      toolCallId: request.request.toolCallId,
      toolId: request.toolId,
      status: request.result.ok ? "completed" : "failed",
      input: request.request.input,
      output: request.result.output,
      errorType: request.result.errorType,
      errorMessage: request.result.errorMessage,
      elapsedMs: request.result.elapsedMs
    });

    return {};
  }

  private normalizeToolIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return [
      ...new Set(
        value
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter((item) => item.length > 0)
      )
    ];
  }

  private normalizeToolId(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private normalizeInput(value: unknown): Record<string, ToolJsonValue> {
    if (!value || Array.isArray(value) || typeof value !== "object") {
      return {};
    }

    return value as Record<string, ToolJsonValue>;
  }

  private toFailureResult(
    toolId: string,
    errorType: string,
    errorMessage: string,
    startedAt: number
  ): ToolExecutionResult {
    return {
      toolId,
      ok: false,
      errorType,
      errorMessage,
      elapsedMs: Date.now() - startedAt
    };
  }

  private getErrorType(error: unknown): string {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      return "canceled";
    }

    const message = this.getRawErrorMessage(error);

    if (
      message.includes("is required") ||
      message.includes("is invalid") ||
      message.includes("must be") ||
      message.includes("can only contain") ||
      message.includes("not allowed") ||
      message.includes("not in allowlist")
    ) {
      return "invalid_tool_input";
    }

    return "tool_execution_failed";
  }

  private getErrorMessage(error: unknown): string {
    const message = this.getRawErrorMessage(error);

    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      return "工具调用超时或已取消";
    }

    if (message === "url is required") {
      return "HTTP 请求参数错误：url 不能为空";
    }

    if (message === "url is invalid") {
      return "HTTP 请求参数错误：url 格式不正确";
    }

    if (message === "url must use http or https") {
      return "HTTP 请求参数错误：只支持 http 或 https 地址";
    }

    if (message === "url hostname is not allowed") {
      return "HTTP 请求被安全策略拦截：目标地址不允许访问";
    }

    if (message === "url hostname is not in allowlist") {
      return "HTTP 请求被安全策略拦截：目标地址不在允许列表中";
    }

    if (message === "method must be GET or POST") {
      return "HTTP 请求参数错误：method 只支持 GET 或 POST";
    }

    if (message === "body must be an object") {
      return "HTTP 请求参数错误：body 必须是对象";
    }

    if (message === "timeoutMs must be a number") {
      return "HTTP 请求参数错误：timeoutMs 必须是数字";
    }

    if (message === "timeoutMs must be between 1 and 30000") {
      return "HTTP 请求参数错误：timeoutMs 必须在 1 到 30000 毫秒之间";
    }

    if (message === "response body is too large") {
      return "HTTP 响应过大，已停止读取";
    }

    if (message === "division by zero is not allowed") {
      return "计算器参数错误：不允许除以 0";
    }

    if (message.includes("operands")) {
      return `计算器参数错误：${message}`;
    }

    if (message.includes("operation")) {
      return `计算器参数错误：${message}`;
    }

    return message || "工具调用失败";
  }

  private getRawErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return "";
  }

  private toJsonSql(value: ToolJsonValue | undefined): Prisma.Sql {
    if (value === undefined) {
      return Prisma.sql`NULL`;
    }

    return Prisma.sql`CAST(${JSON.stringify(value)} AS JSONB)`;
  }
}
