import { ToolDefinition, ToolExecutionRequest, ToolJsonValue } from "./dto/tool.dto";
import { calculatorTool } from "./builtin/calculator.tool";
import { currentTimeTool } from "./builtin/current-time.tool";
import { httpRequestTool } from "./builtin/http-request.tool";

/** 内置工具执行时可用的链路、归属和取消上下文。 */
export type ToolExecutionContext = Pick<
  ToolExecutionRequest,
  "requestId" | "userId" | "agentId" | "signal"
>;

/** 内置工具契约；定义和实现共处注册表但对外只暴露安全定义。 */
export type BuiltinTool = ToolDefinition & {
  execute(
    input: Record<string, ToolJsonValue>,
    context: ToolExecutionContext
  ): Promise<ToolJsonValue>;
};

/** 内置工具显式白名单，新增工具必须在此注册后才可被 Agent 发现。 */
const builtinTools: BuiltinTool[] = [httpRequestTool, calculatorTool, currentTimeTool];

/** 按运行时 ID 建立只读索引，避免每轮模型工具调用线性扫描。 */
const builtinToolMap = new Map(builtinTools.map((tool) => [tool.id, tool]));

export function listBuiltinTools(): ToolDefinition[] {
  return builtinTools.map(toToolDefinition);
}

export function listEnabledBuiltinTools(): ToolDefinition[] {
  return builtinTools.filter((tool) => tool.enabled).map(toToolDefinition);
}

export function getBuiltinTool(toolId: string): BuiltinTool | undefined {
  return builtinToolMap.get(toolId);
}

export function getBuiltinToolDefinitions(toolIds: string[]): ToolDefinition[] {
  return toolIds
    .map((toolId) => builtinToolMap.get(toolId))
    .filter((tool): tool is BuiltinTool => Boolean(tool))
    .filter((tool) => tool.enabled)
    .map(toToolDefinition);
}

function toToolDefinition(tool: BuiltinTool): ToolDefinition {
  // 不返回 execute 函数，确保跨模块 DTO 可序列化且调用方不能绕过 ToolsService。
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    enabled: tool.enabled,
    inputSchema: tool.inputSchema
  };
}
