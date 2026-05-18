export type ToolJsonPrimitive = string | number | boolean | null;
export type ToolJsonValue =
  | ToolJsonPrimitive
  | ToolJsonValue[]
  | {
      [key: string]: ToolJsonValue;
    };

export type ToolInputSchema = {
  type: 'object';
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

export type ToolListItem = Pick<
  ToolDefinition,
  'id' | 'name' | 'description' | 'enabled'
>;

export type ToolExecutionRequest = {
  toolId: string;
  input: Record<string, ToolJsonValue>;
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
