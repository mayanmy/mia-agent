import { Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { ConfiguredHttpToolsService } from "./configured-http-tools.service";
import {
  ToolCallLogRecord,
  ToolDefinition,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolJsonValue,
  ToolListItem
} from "./dto/tool.dto";
import { getBuiltinTool, getBuiltinToolDefinitions, listEnabledBuiltinTools } from "./registry";
import { HttpToolExecutor } from "./http/http-tool.executor";

@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);

  constructor(
    @Optional() private readonly prismaService?: PrismaService,
    @Optional() private readonly configuredHttpTools?: ConfiguredHttpToolsService,
    @Optional() private readonly httpToolExecutor?: HttpToolExecutor
  ) {}

  /** 合并内置工具与管理员预配置工具，供 Agent 绑定页统一展示。 */
  async listTools(): Promise<ToolListItem[]> {
    const builtinTools = listEnabledBuiltinTools().map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      enabled: tool.enabled
    }));
    const configuredTools = this.configuredHttpTools
      ? (await this.configuredHttpTools.listHttpTools()).map((tool) => ({
          id: tool.runtimeId,
          name: tool.name,
          description: tool.description,
          enabled: tool.enabled
        }))
      : [];
    return [...builtinTools, ...configuredTools];
  }

  /** Runtime 按 Agent 绑定顺序解析工具定义，并兼容同步测试替身。 */
  async getToolDefinitions(toolIds: string[]): Promise<ToolDefinition[]> {
    const normalizedToolIds = this.normalizeToolIds(toolIds);
    const builtinDefinitions = getBuiltinToolDefinitions(normalizedToolIds);
    const configuredDefinitions = this.configuredHttpTools
      ? await this.configuredHttpTools.getToolDefinitions(normalizedToolIds)
      : [];
    const definitions = new Map(
      [...builtinDefinitions, ...configuredDefinitions].map((tool) => [tool.id, tool])
    );
    return normalizedToolIds.flatMap((toolId) => {
      const definition = definitions.get(toolId);
      return definition ? [definition] : [];
    });
  }

  async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const startedAt = Date.now();
    const toolId = this.normalizeToolId(request.toolId);
    const tool = getBuiltinTool(toolId);
    const configuredTool = !tool
      ? await this.configuredHttpTools?.resolveRuntimeConfig(toolId)
      : null;

    if ((!tool || !tool.enabled) && !configuredTool) {
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
      const input = this.normalizeInput(request.input);
      const output = configuredTool
        ? await this.requireHttpToolExecutor().execute(configuredTool, input, request.signal)
        : await tool!.execute(input, {
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

  /** 为 Runtime Event、requested 日志和 Run Step 提供同一份脱敏参数视图。 */
  async sanitizeToolInput(
    toolId: string,
    input: Record<string, ToolJsonValue>
  ): Promise<Record<string, ToolJsonValue>> {
    return this.configuredHttpTools ? this.configuredHttpTools.sanitizeInput(toolId, input) : input;
  }

  async recordToolCallLog(record: ToolCallLogRecord): Promise<void> {
    if (!this.prismaService) {
      return;
    }

    try {
      // 使用 Prisma create 让 schema 的 @default(uuid()) 生成主键；原始 INSERT 未写 id，
      // 在数据库默认值被迁移移除后会持续违反非空约束。
      await this.prismaService.toolCallLog.create({
        data: {
          requestId: record.requestId,
          runId: record.runId,
          stepId: record.stepId,
          agentId: record.agentId,
          userId: record.userId,
          toolCallId: record.toolCallId,
          toolId: record.toolId,
          status: record.status,
          source: record.source,
          reason: record.reason,
          input: this.toPrismaJson(record.input),
          output: this.toPrismaJson(record.output),
          errorType: record.errorType,
          errorMessage: record.errorMessage,
          elapsedMs: record.elapsedMs
        }
      });
    } catch (error) {
      // 日志仍是弱依赖，但必须留下错误，避免数据库或迁移问题再次变成“页面永远为空”。
      this.logger.warn(
        `工具调用日志写入失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async recordExecutionResult(request: {
    request: ToolExecutionRequest;
    toolId: string;
    result: ToolExecutionResult;
  }): Promise<Record<string, never>> {
    // 执行结果统一在 ToolsService 记录，确保非 chat 调用和工具不存在场景也能落 completed/failed。
    const sanitizedInput = await this.sanitizeToolInput(request.toolId, request.request.input);
    await this.recordToolCallLog({
      requestId: request.request.requestId,
      runId: request.request.runId,
      stepId: request.request.stepId,
      userId: request.request.userId,
      agentId: request.request.agentId,
      toolCallId: request.request.toolCallId,
      toolId: request.toolId,
      status: request.result.ok ? "completed" : "failed",
      input: sanitizedInput,
      output: request.result.output,
      errorType: request.result.errorType,
      errorMessage: request.result.errorMessage,
      elapsedMs: request.result.elapsedMs
    });

    return {};
  }

  /** 工具绑定去重并保持用户选择顺序。 */
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

  /** 单个工具 ID 在查找前去除无意义空白。 */
  private normalizeToolId(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  /** 工具入参必须是 JSON 对象，异常输入收敛为空对象交给具体工具报错。 */
  private normalizeInput(value: unknown): Record<string, ToolJsonValue> {
    if (!value || Array.isArray(value) || typeof value !== "object") {
      return {};
    }

    return value as Record<string, ToolJsonValue>;
  }

  /** 所有执行失败使用统一结果协议并计算耗时。 */
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

  /** 参数错误、取消与执行故障映射为稳定错误类型。 */
  private getErrorType(error: unknown): string {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      return "canceled";
    }

    const message = this.getRawErrorMessage(error);

    if (
      message.includes("is required") ||
      message.includes("is invalid") ||
      message.includes("must be") ||
      message.includes("unknown parameters") ||
      message.includes("unresolved parameters") ||
      message.includes("can only contain") ||
      message.includes("not allowed") ||
      message.includes("not in allowlist")
    ) {
      return "invalid_tool_input";
    }

    return "tool_execution_failed";
  }

  /** 将底层英文错误转换为可直接展示的中文诊断。 */
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

  /** 配置化工具必须经唯一 Executor 出站，避免测试与 Runtime 行为分叉。 */
  private requireHttpToolExecutor(): HttpToolExecutor {
    if (!this.httpToolExecutor) {
      throw new Error("HTTP Tool Executor 未配置");
    }
    return this.httpToolExecutor;
  }

  /** 安全读取未知异常消息，避免把整个对象序列化进日志。 */
  private getRawErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return "";
  }

  /** 将工具 JSON 转为 Prisma 可接受的输入，显式 null 使用数据库 JSON null。 */
  private toPrismaJson(
    value: ToolJsonValue | undefined
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (value === undefined) {
      return undefined;
    }

    return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
  }
}
