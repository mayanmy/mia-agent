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

export type ToolExecutionRequest = {
  toolId: string;
  input: Record<string, ToolJsonValue>;
  toolCallId?: string;
  requestId?: string;
  userId?: string;
  agentId?: string;
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

export type ToolCallLogStatus =
  | "available"
  | "skipped"
  | "requested"
  | "completed"
  | "failed";

export type ToolCallLogRecord = {
  requestId?: string;
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
