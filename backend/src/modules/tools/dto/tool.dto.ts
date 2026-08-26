export type ToolJsonPrimitive = string | number | boolean | null;
export type ToolJsonValue =
  | ToolJsonPrimitive
  | ToolJsonValue[]
  | {
      [key: string]: ToolJsonValue;
    };

export type ToolInputSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolDefinition = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  inputSchema: ToolInputSchema;
};

export type ToolListItem = Pick<ToolDefinition, "id" | "name" | "description" | "enabled">;

/** Tool Catalog 只保存召回需要的轻量文本，不携带可能很大的 JSON Schema。 */
export type ToolCatalogItem = ToolListItem & {
  source: "builtin" | "http" | "mcp";
  tags?: string[];
};

export type ToolSearchResult = {
  definitions: ToolDefinition[];
  searched: boolean;
  boundToolCount: number;
  catalogMatchCount: number;
  selectedToolIds: string[];
};

export type ToolExecutionRequest = {
  toolId: string;
  input: Record<string, ToolJsonValue>;
  toolCallId?: string;
  requestId?: string;
  runId?: string;
  stepId?: string;
  userId?: string;
  agentId?: string;
  /** 仅内部 Chat Runtime 可请求交互审批，外部 API、Workflow 和测试调用不得开启。 */
  allowInteractiveApproval?: boolean;
  /** 批准后回传的一次性记录 ID；ToolsService 会先校验并消费，再解析真实工具。 */
  approvalId?: string;
  signal?: AbortSignal;
};

export type ToolExecutionResult = {
  toolId: string;
  ok: boolean;
  output?: ToolJsonValue;
  errorType?: string;
  errorMessage?: string;
  elapsedMs: number;
};

export type ToolCallLogStatus = "available" | "skipped" | "requested" | "completed" | "failed";

export type ToolCallLogRecord = {
  requestId?: string;
  runId?: string;
  stepId?: string;
  agentId?: string;
  userId?: string;
  toolCallId?: string;
  toolId?: string;
  status: ToolCallLogStatus;
  source?: string;
  reason?: string;
  input?: ToolJsonValue;
  output?: ToolJsonValue;
  errorType?: string;
  errorMessage?: string;
  elapsedMs?: number;
};
