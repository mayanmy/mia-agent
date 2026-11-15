/** 工具输入输出允许直接序列化的 JSON 基础值。 */
export type ToolJsonPrimitive = string | number | boolean | null;
/** 工具边界允许传递的递归 JSON 值，排除函数、句柄和 SDK 对象。 */
export type ToolJsonValue =
  | ToolJsonPrimitive
  | ToolJsonValue[]
  | {
      [key: string]: ToolJsonValue;
    };

/** 提供给模型和运行时校验器的对象型 JSON Schema 子集。 */
export type ToolInputSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/** 工具可能产生的外部副作用；UNKNOWN 必须采用最保守的重放策略。 */
export type ToolSideEffectLevel =
  "NONE" | "READ" | "IDEMPOTENT_WRITE" | "NON_IDEMPOTENT_WRITE" | "UNKNOWN";

/** Run Replay 对单次工具执行的默认处理方式。 */
export type ToolReplayPolicy = "REUSE" | "REEXECUTE" | "REQUIRE_CONFIRMATION" | "FORBIDDEN";

export type ToolIdempotencyMetadata = {
  supported: boolean;
  transport: "HEADER" | "BODY" | "NATIVE";
  fieldName?: string;
  resultLookupSupported?: boolean;
};

/** 发布版本会把该元数据纳入工具资源指纹，避免策略变化静默影响历史版本。 */
export type ToolReplayMetadata = {
  sideEffectLevel: ToolSideEffectLevel;
  replayPolicy: ToolReplayPolicy;
  idempotency?: ToolIdempotencyMetadata;
};

/** 跨工具来源统一暴露的可调用定义。 */
export type ToolDefinition = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  inputSchema: ToolInputSchema;
  replayMetadata: ToolReplayMetadata;
};

/** 工具管理列表所需的轻量摘要。 */
export type ToolListItem = Pick<ToolDefinition, "id" | "name" | "description" | "enabled">;

/** Tool Catalog 只保存召回需要的轻量文本，不携带可能很大的 JSON Schema。 */
export type ToolCatalogItem = ToolListItem & {
  source: "builtin" | "http" | "mcp";
  tags?: string[];
};

/** Tool Catalog 召回后返回给 Agent Runtime 的选择结果。 */
export type ToolSearchResult = {
  definitions: ToolDefinition[];
  searched: boolean;
  boundToolCount: number;
  catalogMatchCount: number;
  selectedToolIds: string[];
};

/** Tools Service 执行任意来源工具的统一请求。 */
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
  /** 仅 Runtime 内部传递；不得写入 Tool 日志、Trace、模型上下文或管理 API。 */
  idempotencyKey?: string;
  signal?: AbortSignal;
};

/** 工具执行完成后的统一成功或失败结果。 */
export type ToolExecutionResult = {
  toolId: string;
  ok: boolean;
  output?: ToolJsonValue;
  /** 工具通过保留字段 contentParts 声明的用户可见产物。 */
  contentParts?: AgentContentPart[];
  errorType?: string;
  errorMessage?: string;
  elapsedMs: number;
};

/** 工具从可用、选择到执行完成的日志生命周期状态。 */
export type ToolCallLogStatus = "available" | "skipped" | "requested" | "completed" | "failed";

/** Logs 模块接收的可序列化工具调用记录。 */
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
import { AgentContentPart } from "../../agent_runtime/dto/content-part.dto";
