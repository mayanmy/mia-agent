import { Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { McpService } from "../mcp/mcp.service";
import { McpToolExecutor } from "../mcp/mcp-tool.executor";
import { McpApprovalService } from "../mcp/mcp-approval.service";
import { McpToolApprovalDetail, McpToolApprovalDecision } from "../mcp/dto/mcp-approval.dto";
import { ConfiguredHttpToolsService } from "./configured-http-tools.service";
import {
  ToolCallLogRecord,
  ToolCatalogItem,
  ToolDefinition,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolJsonValue,
  ToolListItem,
  ToolSearchResult
} from "./dto/tool.dto";
import { getBuiltinTool, getBuiltinToolDefinitions, listEnabledBuiltinTools } from "./registry";
import { HttpToolExecutor } from "./http/http-tool.executor";

@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);

  constructor(
    @Optional() private readonly prismaService?: PrismaService,
    @Optional() private readonly configuredHttpTools?: ConfiguredHttpToolsService,
    @Optional() private readonly httpToolExecutor?: HttpToolExecutor,
    @Optional() private readonly mcpService?: McpService,
    @Optional() private readonly mcpToolExecutor?: McpToolExecutor,
    @Optional() private readonly mcpApprovalService?: McpApprovalService
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
    const mcpTools = this.mcpService ? await this.mcpService.listRuntimeTools() : [];
    return [...builtinTools, ...configuredTools, ...mcpTools];
  }

  /** Runtime 按 Agent 绑定顺序解析工具定义，并兼容同步测试替身。 */
  async getToolDefinitions(toolIds: string[]): Promise<ToolDefinition[]> {
    const normalizedToolIds = this.normalizeToolIds(toolIds);
    const builtinDefinitions = getBuiltinToolDefinitions(normalizedToolIds);
    const configuredDefinitions = this.configuredHttpTools
      ? await this.configuredHttpTools.getToolDefinitions(normalizedToolIds)
      : [];
    const mcpDefinitions = this.mcpService
      ? await this.mcpService.getRuntimeToolDefinitions(normalizedToolIds)
      : [];
    const definitions = new Map(
      [...builtinDefinitions, ...configuredDefinitions, ...mcpDefinitions].map((tool) => [
        tool.id,
        tool
      ])
    );
    return normalizedToolIds.flatMap((toolId) => {
      const definition = definitions.get(toolId);
      return definition ? [definition] : [];
    });
  }

  /**
   * 绑定数量较小时保持完整 Schema 行为；超过阈值后先检索轻量目录，再延迟加载候选 Schema。
   * 召回完全确定且不调用 LLM，避免 Tool Search 自身引入额外费用和不稳定远程依赖。
   */
  async searchToolDefinitions(
    toolIds: string[],
    query: string,
    systemPrompt: string,
    options: { threshold?: number; limit?: number } = {}
  ): Promise<ToolSearchResult> {
    const normalizedToolIds = this.normalizeToolIds(toolIds);
    const threshold = options.threshold ?? 20;
    const limit = Math.max(1, Math.min(options.limit ?? 12, threshold));
    if (normalizedToolIds.length <= threshold) {
      const definitions = await this.getToolDefinitions(normalizedToolIds);
      return {
        definitions,
        searched: false,
        boundToolCount: normalizedToolIds.length,
        catalogMatchCount: definitions.length,
        selectedToolIds: definitions.map((tool) => tool.id)
      };
    }

    const catalog = await this.getToolCatalog(normalizedToolIds);
    const order = new Map(normalizedToolIds.map((id, index) => [id, index]));
    const queryTerms = this.searchTerms(query);
    const promptTerms = this.searchTerms(systemPrompt);
    const ranked = catalog
      .map((tool) => ({ tool, score: this.scoreCatalogItem(tool, queryTerms, promptTerms) }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          (order.get(left.tool.id) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(right.tool.id) ?? Number.MAX_SAFE_INTEGER)
      );
    // 无文本命中时按绑定顺序兜底，保证宽泛问题仍保留一组稳定候选，而不是完全禁用工具。
    const selectedToolIds = ranked.slice(0, limit).map(({ tool }) => tool.id);
    const definitions = await this.getToolDefinitions(selectedToolIds);
    return {
      definitions,
      searched: true,
      boundToolCount: normalizedToolIds.length,
      catalogMatchCount: catalog.length,
      selectedToolIds: definitions.map((tool) => tool.id)
    };
  }

  private async getToolCatalog(toolIds: string[]): Promise<ToolCatalogItem[]> {
    const builtin = listEnabledBuiltinTools()
      .filter((tool) => toolIds.includes(tool.id))
      .map((tool) => ({ ...tool, source: "builtin" as const }));
    const [configured, mcp] = await Promise.all([
      this.configuredHttpTools?.getToolCatalog(toolIds) ?? Promise.resolve([]),
      this.mcpService?.getRuntimeToolCatalog(toolIds) ?? Promise.resolve([])
    ]);
    const byId = new Map([...builtin, ...configured, ...mcp].map((tool) => [tool.id, tool]));
    return toolIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }

  /** 中英文统一为单词、单字和二元片段，兼顾工具英文名与中文业务描述。 */
  private searchTerms(value: string): Set<string> {
    const normalized = value.toLocaleLowerCase().replace(/[_-]+/gu, " ");
    const terms = new Set(normalized.match(/[a-z0-9]+|[\p{Script=Han}]/gu) ?? []);
    const chinese = Array.from(normalized.replace(/[^\p{Script=Han}]/gu, ""));
    for (let index = 0; index < chinese.length - 1; index += 1) {
      terms.add(`${chinese[index]}${chinese[index + 1]}`);
    }
    return terms;
  }

  private scoreCatalogItem(
    tool: ToolCatalogItem,
    queryTerms: Set<string>,
    promptTerms: Set<string>
  ): number {
    const toolTerms = this.searchTerms(
      [tool.id, tool.name, tool.description, ...(tool.tags ?? [])].join(" ")
    );
    let score = 0;
    for (const term of toolTerms) {
      if (queryTerms.has(term)) score += term.length > 1 ? 8 : 2;
      if (promptTerms.has(term)) score += term.length > 1 ? 2 : 0.5;
    }
    return score;
  }

  async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const startedAt = Date.now();
    const toolId = this.normalizeToolId(request.toolId);
    const tool = getBuiltinTool(toolId);

    try {
      // 每次执行重新解析动态工具状态，管理员停用后无需等待 Agent 配置缓存失效。
      const configuredTool = !tool
        ? await this.configuredHttpTools?.resolveRuntimeConfig(toolId)
        : null;
      if (request.approvalId) {
        await this.requireMcpApprovalService().consume({
          approvalId: request.approvalId,
          runtimeId: toolId,
          input: request.input,
          userId: request.userId ?? "",
          agentId: request.agentId ?? "",
          runId: request.runId ?? ""
        });
      }
      const mcpTool =
        !tool && !configuredTool
          ? await this.mcpService?.resolveRuntimeTool(toolId, Boolean(request.approvalId))
          : null;

      if ((!tool || !tool.enabled) && !configuredTool && !mcpTool) {
        const result = this.toFailureResult(
          toolId,
          "tool_not_found",
          "工具不存在或已停用",
          startedAt
        );
        await this.recordExecutionResult({ request, toolId, result });
        return result;
      }

      const input = this.normalizeInput(request.input);
      const output = mcpTool
        ? await this.requireMcpToolExecutor().execute(mcpTool, input, request.signal)
        : configuredTool
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
      // 交互式审批会在 Runtime 创建 pending 记录；这里不把“等待确认”误写成执行失败。
      if (!(request.allowInteractiveApproval && result.errorType === "mcp_approval_required")) {
        await this.recordExecutionResult({ request, toolId, result });
      }
      return result;
    }
  }

  /** 只允许 Runtime 为 MCP CONFIRM 工具创建审批，具体策略仍由 MCP 模块再次校验。 */
  async createToolApproval(request: ToolExecutionRequest): Promise<McpToolApprovalDetail> {
    if (!request.runId || !request.userId || !request.agentId) {
      throw new Error("交互式工具审批缺少 runId、userId 或 agentId");
    }
    return this.requireMcpApprovalService().createRequest({
      runtimeId: this.normalizeToolId(request.toolId),
      input: request.input,
      runId: request.runId,
      stepId: request.stepId,
      toolCallId: request.toolCallId,
      requestId: request.requestId,
      userId: request.userId,
      agentId: request.agentId
    });
  }

  async waitForToolApproval(
    approvalId: string,
    signal?: AbortSignal
  ): Promise<McpToolApprovalDecision> {
    return this.requireMcpApprovalService().waitForDecision(approvalId, signal);
  }

  /** 为 Runtime Event、requested 日志和 Run Step 提供同一份脱敏参数视图。 */
  async sanitizeToolInput(
    toolId: string,
    input: Record<string, ToolJsonValue>
  ): Promise<Record<string, ToolJsonValue>> {
    if (toolId.startsWith("mcp_") && this.mcpService) {
      return this.mcpService.sanitizeRuntimeInput(toolId, input);
    }
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
      source: request.toolId.startsWith("mcp_")
        ? "mcp"
        : request.toolId.startsWith("http_")
          ? "http"
          : "builtin",
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
    if (error && typeof error === "object" && "errorType" in error) {
      return String(error.errorType);
    }
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

  /** MCP Tool 仍由 ToolsService 统一调度，Executor 只负责协议和资源治理。 */
  private requireMcpToolExecutor(): McpToolExecutor {
    if (!this.mcpToolExecutor) {
      throw new Error("MCP Tool Executor 未配置");
    }
    return this.mcpToolExecutor;
  }

  private requireMcpApprovalService(): McpApprovalService {
    if (!this.mcpApprovalService) {
      throw new Error("MCP Approval Service 未配置");
    }
    return this.mcpApprovalService;
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
