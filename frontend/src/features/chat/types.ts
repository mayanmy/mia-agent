import type {
  ChatFileAttachment,
  ChatImageAttachment,
  ChatMessage,
  ChatRetrievalSource
} from "./api";

/** 工具从发起到完成期间在聊天消息中的 UI 状态。 */
export type ChatToolEvent = {
  /** 工具调用事件 ID，用于将结果合并回对应调用。 */
  id: string;
  /** 工具注册名称。 */
  name: string;
  /** 模型生成并经解析的工具参数。 */
  arguments?: Record<string, unknown>;
  /** 工具调用在 UI 中的当前状态。 */
  status: "running" | "success" | "error";
  /** 成功执行后的结构化输出。 */
  output?: unknown;
  /** 失败错误分类。 */
  errorType?: string;
  /** 失败错误说明。 */
  errorMessage?: string;
  /** 工具执行耗时毫秒数。 */
  elapsedMs?: number;
};

/** 一次知识检索在聊天消息中的 UI 状态及来源快照。 */
export type ChatRetrievalEvent = {
  /** 本地检索事件 ID。 */
  id: string;
  /** 本次计划检索的知识库 ID。 */
  knowledgeBaseIds: string[];
  /** 检索在 UI 中的当前状态。 */
  status: "running" | "success";
  /** 检索完成后返回的来源。 */
  sources: ChatRetrievalSource[];
  /** 检索耗时毫秒数。 */
  elapsedMs?: number;
};

/** 前端渲染使用的消息模型，在 API 消息上扩展本地状态和过程事件。 */
export type ChatUiMessage = ChatMessage & {
  /** 浏览器侧稳定渲染 ID。 */
  id: string;
  /** 浏览器侧毫秒时间戳。 */
  createdAt: number;
  /** 归属于该 assistant 消息的检索过程。 */
  retrievalEvents?: ChatRetrievalEvent[];
  /** 归属于该 assistant 消息的工具调用过程。 */
  toolEvents?: ChatToolEvent[];
  /** 用户消息携带的图片附件。 */
  images?: ChatImageAttachment[];
  /** 用户消息携带的文本附件。 */
  files?: ChatFileAttachment[];
};
