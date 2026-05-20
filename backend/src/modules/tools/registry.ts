import {
  ToolDefinition,
  ToolExecutionRequest,
  ToolJsonValue,
} from './dto/tool.dto';
import { calculatorTool } from './builtin/calculator.tool';
import { currentTimeTool } from './builtin/current-time.tool';
import { httpRequestTool } from './builtin/http-request.tool';

export type ToolExecutionContext = Pick<
  ToolExecutionRequest,
  'requestId' | 'userId' | 'agentId' | 'signal'
>;

export type BuiltinTool = ToolDefinition & {
  execute(
    input: Record<string, ToolJsonValue>,
    context: ToolExecutionContext,
  ): Promise<ToolJsonValue>;
};

const builtinTools: BuiltinTool[] = [
  httpRequestTool,
  calculatorTool,
  currentTimeTool,
];

const builtinToolMap = new Map(
  builtinTools.map((tool) => [tool.id, tool]),
);

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
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    enabled: tool.enabled,
    inputSchema: tool.inputSchema,
  };
}
