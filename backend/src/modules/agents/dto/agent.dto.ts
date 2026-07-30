import {
  AgentChatSessionMode,
  AgentExecutionMode,
  ModelConfigType,
  ModelProviderType
} from "@prisma/client";

/** JSON 中允许直接序列化的基础值。 */
export type JsonPrimitive = string | number | boolean | null;
/** Agent 扩展生成参数允许使用的递归 JSON 值。 */
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
/** 以字符串键组织的 JSON 对象。 */
export type JsonObject = { [key: string]: JsonValue };

/** 透传给模型供应商的扩展生成参数，不包含 Mia 的固定生成字段。 */
export type AgentGenerationParams = JsonObject;

/** 创建 Agent 的输入；所有字段在 Service 中完成默认值和边界校验。 */
export type AgentCreateDto = {
  /** 团队成员可见的 Agent 名称。 */
  name?: string;
  /** Agent 的用途说明，展示在列表和公开页面。 */
  description?: string;
  /** 每次模型调用前注入的系统提示词。 */
  systemPrompt?: string;
  /** 绑定的 Chat 类型模型配置 ID。 */
  modelConfigId?: string;
  /** 模型采样温度。 */
  temperature?: number;
  /** 单次生成 token 上限；null 表示沿用模型配置。 */
  maxTokens?: number | null;
  /** 单次模型调用超时秒数。 */
  timeoutSeconds?: number;
  /** 进入模型上下文的最近历史轮数。 */
  historyTurns?: number;
  /** 对话采用临时历史还是服务端持久会话。 */
  chatSessionMode?: AgentChatSessionMode;
  /** 模型供应商特有的附加生成参数。 */
  generationParams?: AgentGenerationParams | null;
  /** 是否允许普通成员使用该 Agent。 */
  enabled?: boolean;
};

/** 更新 Agent 的输入；未提供的字段保持原值。 */
export type AgentUpdateDto = Partial<AgentCreateDto>;

/** Agent 管理列表的分页与状态筛选参数。 */
export type AgentQueryDto = {
  /** 从 1 开始的页码。 */
  page?: string;
  /** 每页记录数。 */
  pageSize?: string;
  /** 可选启用状态筛选，字符串由 Service 严格解析。 */
  enabled?: string;
};

/** Agent 所绑定模型及供应商的安全摘要，不包含 API Key。 */
export type AgentModelConfigSummary = {
  /** 模型配置 ID。 */
  id: string;
  /** 供应商侧模型名称。 */
  modelName: string;
  /** 模型用途类型，Agent 只能绑定 Chat 模型。 */
  modelType: ModelConfigType;
  /** 模型供应商 ID。 */
  providerId: string;
  /** 模型供应商展示名称。 */
  providerName: string;
  /** 决定调用客户端实现的供应商类型。 */
  providerType: ModelProviderType;
};

/** Agent 管理列表中的摘要信息。 */
export type AgentListItem = {
  /** Agent ID。 */
  id: string;
  /** Agent 展示名称。 */
  name: string;
  /** Agent 用途说明。 */
  description: string;
  /** 当前绑定的模型配置 ID。 */
  modelConfigId: string;
  /** 当前模型名称。 */
  modelName: string;
  /** 当前模型供应商名称。 */
  providerName: string;
  /** 已绑定工具数量。 */
  toolCount: number;
  /** 已绑定知识库数量。 */
  knowledgeBaseCount: number;
  /** 当前采样温度。 */
  temperature: number;
  /** 当前会话持久化模式。 */
  chatSessionMode: AgentChatSessionMode;
  /** 直接模型调用或工作流执行模式。 */
  executionMode: AgentExecutionMode;
  /** 是否允许团队成员使用。 */
  enabled: boolean;
  /** 是否已经开放分享链接。 */
  published: boolean;
  /** 最近一次发布时间；未发布时为 null。 */
  publishedAt: Date | null;
  /** 公开链接令牌；未发布时为 null。 */
  shareToken: string | null;
  /** Agent 创建时间。 */
  createdAt: Date;
  /** Agent 最近更新时间。 */
  updatedAt: Date;
};

/** Agent 编辑页与运行配置需要的完整详情。 */
export type AgentDetail = AgentListItem & {
  /** 系统提示词全文。 */
  systemPrompt: string;
  /** 生成 token 上限；null 表示沿用模型默认值。 */
  maxTokens: number | null;
  /** 模型调用超时秒数。 */
  timeoutSeconds: number;
  /** 进入上下文的历史轮数。 */
  historyTurns: number;
  /** 对话会话模式。 */
  chatSessionMode: AgentChatSessionMode;
  /** 模型扩展生成参数。 */
  generationParams: AgentGenerationParams | null;
  /** 已绑定工具 ID 列表。 */
  toolIds: string[];
  /** 已绑定知识库 ID 列表。 */
  knowledgeBaseIds: string[];
  /** 模型及供应商安全摘要。 */
  modelConfig: AgentModelConfigSummary;
  /** 工作流绑定；直接对话模式下为 null。 */
  workflow: AgentWorkflowBinding | null;
};

/** Agent 当前绑定的已发布工作流版本。 */
export type AgentWorkflowBinding = {
  /** 工作流 ID。 */
  workflowId: string;
  /** 固定执行的工作流版本 ID，避免草稿变更影响线上 Agent。 */
  workflowVersionId: string;
};

/** 更新 Agent 执行模式与工作流绑定的输入。 */
export type AgentWorkflowBindingDto = {
  /** 目标执行模式。 */
  executionMode?: AgentExecutionMode;
  /** 待绑定工作流 ID；null 用于解除绑定。 */
  workflowId?: string | null;
  /** 待绑定的已发布版本 ID；null 用于解除绑定。 */
  workflowVersionId?: string | null;
};

/** 更新工作流绑定后的结果。 */
export type AgentWorkflowBindingResult = {
  /** Agent ID。 */
  agentId: string;
  /** 更新后的执行模式。 */
  executionMode: AgentExecutionMode;
  /** 更新后的工作流绑定。 */
  workflow: AgentWorkflowBinding | null;
};

/** 批量替换 Agent 工具绑定的输入。 */
export type AgentToolBindingDto = {
  /** 目标工具 ID 集合；空数组表示解除全部绑定。 */
  toolIds?: string[];
};

/** Agent 工具绑定结果。 */
export type AgentToolBindingResult = {
  /** Agent ID。 */
  agentId: string;
  /** 实际保存的工具 ID 列表。 */
  toolIds: string[];
};

/** 批量替换 Agent 知识库绑定的输入。 */
export type AgentKnowledgeBaseBindingDto = {
  /** 目标知识库 ID 集合；空数组表示解除全部绑定。 */
  knowledgeBaseIds?: string[];
};

/** Agent 知识库绑定结果。 */
export type AgentKnowledgeBaseBindingResult = {
  /** Agent ID。 */
  agentId: string;
  /** 实际保存的知识库 ID 列表。 */
  knowledgeBaseIds: string[];
};

/** 发布、取消发布或轮换公开令牌后的状态。 */
export type AgentPublishResult = {
  /** Agent ID。 */
  agentId: string;
  /** 当前是否处于发布状态。 */
  published: boolean;
  /** 最近发布时间；未发布时为 null。 */
  publishedAt: Date | null;
  /** 当前公开链接令牌；未发布时为 null。 */
  shareToken: string | null;
};

/** 匿名访问者可读取的最小 Agent 信息。 */
export type SharedAgentDetail = {
  /** Agent ID。 */
  id: string;
  /** Agent 展示名称。 */
  name: string;
  /** Agent 用途说明。 */
  description: string;
  /** 对外展示的模型名称。 */
  modelName: string;
  /** 对外展示的供应商名称。 */
  providerName: string;
  /** 访问前是否需要验证分享密码。 */
  passwordRequired?: boolean;
};

/** 仅供 external_access 模块使用的公开运行时配置，不可返回给通用工作台接口。 */
export type AgentPublicAccessRuntime = SharedAgentDetail & {
  /** 公开访问到期时间；null 表示不过期。 */
  publicExpiresAt: Date | null;
  /** 允许嵌入 Widget 的来源白名单。 */
  publicAllowedOrigins: string[];
  /** 分享密码哈希；未设置密码时为 null，禁止返回给控制器。 */
  publicPasswordHash: string | null;
};

/** 管理端可读取的公开访问安全策略。 */
export type AgentPublicAccessConfig = {
  /** Agent ID。 */
  agentId: string;
  /** 公开访问到期时间；null 表示不过期。 */
  publicExpiresAt: Date | null;
  /** 允许嵌入 Widget 的来源白名单。 */
  publicAllowedOrigins: string[];
  /** 是否已经设置访问密码，不暴露密码哈希。 */
  passwordRequired: boolean;
};

/** Chat/Runtime 模块执行 Agent 所需的稳定跨模块配置。 */
export type AgentRuntimeConfig = {
  /** Agent ID。 */
  agentId: string;
  /** Agent 名称，用于日志和运行记录。 */
  name: string;
  /** 注入模型上下文的系统提示词。 */
  systemPrompt: string;
  /** 模型配置 ID。 */
  modelConfigId: string;
  /** 供应商侧模型名称。 */
  modelName: string;
  /** 模型供应商 ID。 */
  providerId: string;
  /** 模型供应商类型。 */
  providerType: ModelProviderType;
  /** 模型供应商 API 基础地址。 */
  baseUrl: string;
  /** 采样温度。 */
  temperature: number;
  /** 生成 token 上限。 */
  maxTokens: number | null;
  /** 模型调用超时秒数。 */
  timeoutSeconds: number;
  /** 模型上下文保留的历史轮数。 */
  historyTurns: number;
  /** 对话会话模式。 */
  chatSessionMode: AgentChatSessionMode;
  /** 直接对话或工作流执行模式。 */
  executionMode: AgentExecutionMode;
  /** 运行时固定的工作流版本绑定。 */
  workflow: AgentWorkflowBinding | null;
  /** 模型扩展生成参数。 */
  generationParams: AgentGenerationParams | null;
  /** 检索模块需要查询的知识库 ID。 */
  knowledgeBaseIds: string[];
  /** Runtime 允许调用的工具 ID。 */
  toolIds: string[];
};
