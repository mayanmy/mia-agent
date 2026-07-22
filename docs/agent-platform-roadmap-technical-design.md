# Mia 成熟 Agent 平台技术路线

## 1. 文档目标

本文定义 Mia 从当前内部 Agent + RAG 工作台演进为成熟 Agent 平台的技术路线，目标能力范围为：

```text
Agent + Knowledge + Builtin Tools + MCP + Skills
```

本文重点回答：

1. Mia 当前已经具备哪些基础能力。
2. 距离成熟、稳定、可运营的 Agent 平台还缺少什么。
3. 各能力应按什么版本顺序建设。
4. 新模块、数据模型和调用边界如何设计。
5. 每个版本以什么标准判断完成。

本文不是开放插件平台或可视化 Workflow 的设计。Mia 仍按单团队、20-50 人、本地部署、单人维护的约束进行取舍。

## 2. 当前能力基线

Mia 当前已经具备以下核心骨架：

- Agent 创建、配置、启停和发布。
- System Prompt、模型参数、知识库和工具绑定。
- OpenAI-compatible Chat/Embedding 模型调用。
- Knowledge 文档解析、切分、Embedding 和 pgvector 检索。
- Chat SSE 流式输出、会话历史和用户取消信号传递。
- HTTP 请求、计算器、当前时间等 Builtin Tools。
- 模型原生 Tool Call、文本 Tool Call 兼容和多轮工具调用。
- 工具调用日志、请求 ID、错误日志和基础使用记录。
- Admin/User 权限、公开分享、Service API 和嵌入组件。

当前 Agent 运行配置已经可以表达：

```text
AgentRuntimeConfig
  - systemPrompt
  - modelConfig
  - generationParams
  - knowledgeBaseIds
  - toolIds
```

当前主要问题不是缺少一次模型调用，而是缺少一个独立、可观测、可版本化的 Agent Runtime。继续直接向 `chat.service` 叠加 MCP 和 Skills，会使运行编排、错误定位和权限控制快速复杂化。

## 3. 建设原则

### 3.1 Runtime 优先于能力数量

新增 MCP 和 Skills 前，先统一一次 Agent Run 的生命周期、事件、状态和日志。所有入口复用同一运行时：

```text
Web Chat
Public Agent
Embedded Widget
Service API
Future Async Task
        |
        v
Agent Runtime
```

### 3.2 Chat 只负责交互协议

`chat` 模块负责会话、SSE、客户端断开和消息持久化，不继续承载全部 Agent 执行编排。Agent 执行由上层 `agent_runtime` 模块负责。

### 3.3 工具执行入口统一

Builtin Tool 和 MCP Tool 对 Chat/Runtime 暴露相同的定义和结果：

```text
ToolDefinition -> ToolCall -> ToolExecutionResult
```

Runtime 不根据来源分别实现两套 Tool Loop。

### 3.4 Skills 是受控指令包

第一阶段 Skill 只包含可审计的 Instructions、资源依赖和版本信息，不允许用户上传任意脚本。Skill 不等于知识库，也不等于工具。

### 3.5 安全边界先于开放扩展

Mia 不建设开放插件市场，不允许运行未经管理员批准的本地命令或扩展代码。MCP Server、Skill 和敏感工具均由管理员管理。

### 3.6 保持模块可拆分边界

跨模块只通过公开 Service 和 DTO 调用，不返回 Prisma Model，不跨模块直接查询其他模块所属表。

## 4. 目标架构

```text
chat / external_access
          |
          v
agent_runtime ---------> agent_runs
    |       |                 |
    |       +---------------> logs
    |
    +----> agents
    +----> skills
    +----> retrieval -------> knowledge
    +----> model_providers
    +----> tools -----------> mcp
```

推荐最终模块结构：

```text
backend/src/modules/
  agents/             Agent 元数据和版本
  agent_runtime/      单次 Agent 执行编排
  agent_runs/         Run、Step 和事件记录
  chat/               会话、消息和 SSE 适配
  knowledge/          知识库、文档和 Chunk 生命周期
  retrieval/          Embedding、召回和上下文构造
  model_providers/    模型配置和统一模型网关
  tools/              工具定义、策略和统一执行入口
  mcp/                MCP 连接、发现和工具适配
  skills/             Skill 定义、版本和 Agent 绑定
  evaluations/        评测集和评测运行
  memory/             后续长期记忆
  hooks/              后续声明式生命周期扩展
  logs/               审计、错误和用量日志
```

## 5. 版本路线总览

| 版本 | 产品目标 | 核心交付 |
| --- | --- | --- |
| V1 | Agent 稳定投入内部使用 | Runtime、Run Trace、模型韧性、Knowledge 任务化、Tool 安全 |
| V2 | Agent 安全连接企业系统 | HTTP MCP、工具发现、统一工具网关、Skills |
| V3 | Agent 可持续优化和发布 | Agent 版本、评测、反馈、调试器 |
| V4 | Agent 承担持续和复杂任务 | Memory、异步任务、受控 Subagents、声明式 Hooks |

## 6. V1：稳定可用的 Agent 工作台

### 6.1 目标

让团队成员可以稳定使用 Agent，让管理员可以解释和定位每一次运行的结果。V1 不以增加更多外部能力为目标，而是完成 MCP 和 Skills 所需的运行基础。

### 6.2 统一 Agent Runtime

新增 `agent_runtime` 模块，负责：

1. 加载 `AgentRuntimeConfig`。
2. 加载会话历史和附件。
3. 执行 Retrieval。
4. 按固定优先级组装 Prompt。
5. 调用模型并消费流式事件。
6. 执行 Tool Loop。
7. 处理取消、超时和失败。
8. 写入 Run、Step、日志和用量。
9. 向调用方输出统一事件。

建议 DTO：

```typescript
export type AgentRunRequest = {
  requestId: string;
  agentId: string;
  userId?: string;
  sessionId?: string;
  message: AgentInputMessage;
  signal?: AbortSignal;
};

export type AgentRuntimeEvent =
  | { type: "run_started"; data: { runId: string } }
  | { type: "retrieval_started"; data: Record<string, never> }
  | { type: "retrieval_completed"; data: RetrievalContext }
  | { type: "model_started"; data: { modelConfigId: string } }
  | { type: "token"; data: { content: string } }
  | { type: "tool_started"; data: RuntimeToolCall }
  | { type: "tool_completed"; data: RuntimeToolResult }
  | { type: "run_completed"; data: RuntimeUsage }
  | { type: "run_failed"; data: RuntimeError }
  | { type: "run_canceled"; data: Record<string, never> };
```

现有 SSE 事件可以由 `chat` 模块从 `AgentRuntimeEvent` 映射，避免一次性破坏前端协议。

### 6.3 Agent Run 和 Step

新增 `agent_runs` 模块及所属数据表：

```text
AgentRun
  id
  requestId
  agentId
  agentVersionId
  userId
  sessionId
  status
  inputPreview
  outputPreview
  modelConfigId
  startedAt
  firstTokenAt
  finishedAt
  inputTokens
  outputTokens
  estimatedCost
  errorType
  errorMessage

AgentRunStep
  id
  runId
  sequence
  type: retrieval | model | tool | hook
  status
  input
  output
  elapsedMs
  startedAt
  finishedAt
```

Run 状态固定为：

```text
queued -> running -> completed
                  -> failed
                  -> canceled
                  -> timed_out
```

运行日志失败不得导致主对话失败；Run 的最终状态更新应尽可能在 `finally` 中完成。

### 6.4 模型调用韧性

`model_providers` 需要补齐：

- 全局和 Provider 级并发限制。
- 获取并发槽位超时。
- 连接、首 Token、Token 空闲和总时长分层超时。
- 指数退避、jitter 和 `Retry-After` 上限。
- 网络、限流、鉴权、参数、上下文超长、取消等错误分类。
- Provider 健康状态和熔断。
- 流式输出 Token 后不自动重试。
- 用户取消向模型 HTTP 请求传播。

推荐初始限制：

```text
全局 LLM 并发：10
单 Provider 并发：5
Embedding 并发：3
获取槽位超时：10 秒
首 Token 超时：30 秒
Token 空闲超时：60 秒
单次 Run 总时长：180 秒
Tool 最大轮数：3
```

### 6.5 Knowledge 索引任务化

上传接口只保存文档并创建任务，解析、切分和向量化由后台 Worker 编排。

状态机：

```text
uploaded -> queued -> parsing -> chunking -> embedding -> ready
                          |          |           |
                          +----------+-----------+-> failed -> retrying
```

新增索引任务记录，至少包含：

```text
documentId, status, currentStage, retryCount, progress,
errorType, errorMessage, startedAt, finishedAt
```

V1 可使用 PostgreSQL 任务表和进程内 Worker，不提前引入 Redis。需要支持失败重试、手动重建、删除清理、Embedding 模型变更重建和进程重启恢复。

### 6.6 RAG 质量控制

增加以下可配置项：

```text
retrievalEnabled
retrievalTopK
retrievalScoreThreshold
retrievalMaxTokens
citationEnabled
```

检索流程补充：

- 按分数阈值过滤。
- 重复 Chunk 去重。
- 相邻 Chunk 合并。
- 按总 Token 预算裁剪。
- 保留文件名、标题、页码等来源元数据。
- 无有效召回时不注入伪上下文。
- 提供管理端检索调试接口。

### 6.7 Builtin Tool 安全治理

在现有 ToolDefinition 之外引入 ToolPolicy：

```text
timeoutMs
maxInputBytes
maxOutputBytes
concurrencyLimit
allowedHosts
allowedMethods
sensitive
requireConfirmation
```

HTTP Tool 必须覆盖 DNS Rebinding、私网地址、重定向后二次校验、请求与响应大小限制、Secret 脱敏和取消传播。

### 6.8 V1 验收标准

- 30-50 个 SSE 并发下服务稳定。
- 用户取消可以终止上游模型和工具调用。
- 每次运行可通过 `request_id` 和 `run_id` 查看完整 Timeline。
- 模型、检索和工具错误具有明确分类。
- 文档索引失败可重试，进程重启后任务可恢复。
- 引用包含稳定的文档和位置元数据。
- HTTP Tool 默认不能访问未授权内网地址。

## 7. V2：MCP 和 Skills

### 7.1 MCP 模块边界

新增 `mcp` 模块，负责连接配置、能力发现、健康检查和 MCP 协议适配。`chat` 不直接依赖 MCP；`tools.service` 将 MCP Tool 适配为统一工具。

```text
Agent Runtime
  -> ToolsService
       -> Builtin Tool
       -> McpService
            -> MCP Server
```

建议目录：

```text
backend/src/modules/mcp/
  mcp.module.ts
  mcp.controller.ts
  mcp.service.ts
  mcp-connection.service.ts
  mcp-tool-adapter.ts
  dto/
  clients/
```

### 7.2 MCP 数据模型

```text
McpServer
  id
  name
  description
  transport
  endpoint
  command
  encryptedConfig
  enabled
  healthStatus
  lastConnectedAt
  lastError

McpServerTool
  serverId
  toolName
  title
  description
  inputSchema
  schemaHash
  enabled
  discoveredAt

AgentMcpServer
  agentId
  mcpServerId

AgentMcpTool
  agentId
  mcpServerId
  toolName
  enabled
```

### 7.3 MCP 首期范围

V2 优先支持：

- Streamable HTTP Transport。
- Server 连接测试和健康状态。
- Tool 发现与 Schema 缓存。
- Agent 级 Tool 白名单。
- Tool 参数 Schema 校验。
- 超时、并发、取消和输出裁剪。
- 凭证加密及日志脱敏。
- 调用结果写入 AgentRunStep。

V2 暂不支持：

- 用户提供任意本地 stdio 命令。
- MCP Sampling。
- 动态安装第三方进程。
- 开放插件市场。

`stdio` 可在 V2.1 增加，但只能由管理员从预置命令中选择。

### 7.4 MCP 调用授权链

```text
Agent 是否绑定 Server
-> Tool 是否在白名单
-> 用户是否有 Agent 使用权限
-> 参数是否通过 Schema 校验
-> 是否需要用户确认
-> 是否满足超时、并发和网络策略
-> 执行
-> 输出裁剪与脱敏
-> 写 Run Step 和审计日志
```

### 7.5 Skills 模块

Skill 定义一类任务的稳定工作方法，不保存组织事实，不直接等同于工具。

建议目录：

```text
backend/src/modules/skills/
  skills.module.ts
  skills.controller.ts
  skills.service.ts
  skill-renderer.ts
  dto/
```

数据模型：

```text
Skill
  id
  name
  description
  instructions
  version
  status
  enabled
  createdBy
  createdAt
  updatedAt

SkillRequirement
  skillId
  type: builtin_tool | mcp_tool | knowledge_base
  resourceId
  required

AgentSkill
  agentId
  skillId
  priority
  enabled
```

### 7.6 Prompt 组装顺序

最终模型上下文按以下顺序和优先级生成：

```text
1. 平台安全规则
2. Agent System Prompt
3. Skill Instructions
4. Tool 使用约束
5. RAG Context
6. 会话历史
7. 用户输入
```

冲突优先级：

```text
平台规则 > Agent 规则 > Skill 规则 > 知识内容 > 用户输入中的指令
```

Skill 启用时必须校验必需工具和知识库是否可用。需要设置 Skill 数量和 Prompt Token 上限，避免多个 Skill 无限制占用上下文。

### 7.7 V2 验收标准

- 管理员可以配置并测试 HTTP MCP Server。
- Mia 可以发现、缓存和刷新 MCP Tool。
- Agent 只能调用明确授权的 MCP Tool。
- MCP Secret 不进入 Prompt、普通 API 响应和日志。
- Builtin Tool 与 MCP Tool 共用同一个 Tool Loop。
- Skill 可以被多个 Agent 复用并声明资源依赖。
- 管理员可以预览 Agent 最终生效的 Prompt 和工具清单。

## 8. V3：版本、评测和持续优化

### 8.1 Agent 不可变版本

新增 AgentVersion：

```text
Agent
  id
  name
  draftVersionId
  publishedVersionId

AgentVersion
  id
  agentId
  version
  systemPrompt
  modelConfig
  generationParams
  retrievalConfig
  toolBindings
  mcpBindings
  skillBindings
  createdBy
  createdAt
```

一次 Run 必须绑定 `agentVersionId`。草稿修改不能影响已经发布的 Agent。支持版本 Diff、发布、历史查看、回滚和克隆。

### 8.2 评测系统

新增：

```text
EvaluationDataset
EvaluationCase
EvaluationRun
EvaluationResult
```

评测用例至少支持：

```text
input
expectedAnswer
expectedSources
expectedTools
forbiddenContent
tags
```

评测维度包括回答正确性、引用准确性、检索召回、工具选择、禁止工具调用、延迟、Token、成本和错误率。

首期评分方式采用规则断言、来源匹配、Tool Call 断言、人工审核和可选 LLM-as-Judge，不建设复杂实验平台。

### 8.3 用户反馈

回答反馈关联以下运行信息：

```text
runId
messageId
agentVersionId
retrievalChunks
toolCalls
modelConfigId
```

支持点赞、点踩、文字反馈、错误引用、缺少知识和工具执行错误等分类。

### 8.4 运行调试器

管理员可以查看：

- 最终 System Prompt 和注入的 Skills。
- 检索 Chunk、分数及来源。
- 暴露给模型的工具列表。
- 模型返回的原始 Tool Call。
- 每个 Run Step 的耗时和状态。
- Token、成本和错误类型。

敏感配置和工具输出默认脱敏，只有授权管理员可查看受限字段。

### 8.5 V3 验收标准

- Agent 配置可以发布、比较和回滚。
- 发布前可以运行固定评测集。
- 可以比较两个 AgentVersion 的质量、延迟和成本。
- 用户反馈能定位到具体 Run 和版本。
- 管理员能判断问题主要来自 Prompt、Knowledge、模型或 Tool。

## 9. V4：Memory、异步任务和受控委派

### 9.1 Memory

Memory 与会话历史、Knowledge 分开：

```text
会话历史：当前会话上下文
Memory：从用户交互中提取的长期信息
Knowledge：管理员维护的可信组织知识
```

建议模型：

```text
AgentMemory
  id
  agentId
  userId
  scope
  content
  sourceRunId
  confidence
  expiresAt
  createdAt
```

Memory 必须允许用户查看和删除，按 Agent 和用户隔离，并具备敏感信息过滤和过期策略。不得将完整会话历史无条件永久向量化。

### 9.2 异步 Agent Task

长任务不持续占用 SSE 连接：

```text
AgentTask
  id
  agentId
  agentVersionId
  userId
  input
  status
  progress
  result
  idempotencyKey
  cancelRequestedAt
  startedAt
  finishedAt
```

支持后台执行、进度查询、取消、失败重试、结果通知、幂等和进程重启恢复。

### 9.3 受控 Subagents

Subagent 使用固定委派关系：

```text
AgentDelegation
  parentAgentId
  childAgentId
  allowedTaskTypes
  maxCalls
  timeoutSeconds
  contextPolicy
```

首期约束：

- 最大委派深度为 1。
- 单次 Run 最多 3 个子任务。
- 默认串行执行。
- 子 Agent 不能继续委派。
- 子 Agent 权限不能超过父 Agent。
- 父 Agent 只传递完成任务所需的上下文。
- 子任务具有独立 Run、Token、超时和日志。
- 总预算由父 Run 统一限制。

### 9.4 声明式 Hooks

生命周期节点固定为：

```text
before_run
after_retrieval
before_model
before_tool
after_tool
after_run
on_error
on_cancel
```

优先支持审计、内容过滤、字段脱敏、通知、配额检查和受控 Webhook。V4 仍不允许用户上传任意 JavaScript Hook。

### 9.5 V4 验收标准

- 长任务可以后台执行、取消和恢复。
- 用户可以查看、删除和禁用长期 Memory。
- 固定父子 Agent 可以在严格预算和权限下完成委派。
- 生命周期扩展不需要修改 Chat 主流程。
- 子 Run、Hook 和父 Run 可通过统一 Trace 关联。

## 10. 横跨版本的基础能力

### 10.1 资源权限

在 Admin/User 角色之上增加轻量资源权限：

```text
范围：private | workspace | public
操作：view | use | edit | manage
```

权限逐步覆盖 Agent、Knowledge Base、Skill、MCP Server、MCP Tool、Run Log 和 Evaluation Dataset，不引入通用复杂 RBAC 引擎。

### 10.2 Secret 管理

Provider Key、MCP Token 和 Webhook Secret 必须满足：

- 加密存储。
- API 永不返回明文。
- 日志和 Run Step 自动脱敏。
- 支持轮换。
- 记录修改者和修改时间。
- 不进入 Prompt。
- Tool 输出经过敏感字段过滤。

### 10.3 可观测性

统一贯穿：

```text
request_id
run_id
session_id
agent_id
agent_version_id
user_id
model_config_id
tool_call_id
mcp_server_id
```

核心指标：

- 请求量、成功率、失败率和取消率。
- 首 Token 和完整响应延迟。
- Tool/MCP 调用成功率和延迟。
- Retrieval 耗时、召回数量和有效召回率。
- Token、成本和 Provider 错误率。
- Provider 熔断状态。
- 文档索引任务积压和失败率。

### 10.4 配额和预算

逐步支持：

- 单用户和单 Agent 并发。
- 每日 Token 上限。
- 单次输入、输出和上下文 Token 上限。
- 单次 Tool Call 轮数和数量。
- MCP 调用频率。
- 上传文件大小和总容量。
- 父 Run 和子 Run 总预算。

## 11. 推荐实施顺序

按实际开发任务排序：

1. 建立 `AgentRun`、`AgentRunStep` 和统一 `AgentRuntimeEvent`。
2. 从 `chat.service` 抽出 `agent_runtime` 编排。
3. 补齐模型并发、分层超时、取消、重试、错误分类和熔断。
4. 将 Knowledge 索引改为可恢复后台任务。
5. 增加检索调试和 RAG Token 预算。
6. 为 Builtin Tool 增加统一 ToolPolicy。
7. 实现 HTTP MCP 连接、发现和调用。
8. 让 Builtin/MCP 共用统一 Tool Registry 和执行入口。
9. 实现 Skill、SkillRequirement 和 AgentSkill。
10. 实现 AgentVersion、发布和回滚。
11. 实现评测集、版本对比和用户反馈。
12. 最后建设 Memory、异步任务、Subagents 和 Hooks。

## 12. 明确不做

在上述路线内仍不建设：

- Dify 式可视化 Workflow/Chatflow。
- 开放插件市场和模板市场。
- 未经管理员批准的第三方可执行代码。
- 任意用户提供的 stdio 命令。
- 通用微服务框架、服务发现和分布式事务。
- 多租户计费和商业化能力。
- 无边界递归 Subagent。
- 任意 JavaScript/Python Hook。

## 13. 关键风险和控制措施

| 风险 | 控制措施 |
| --- | --- |
| `chat.service` 持续膨胀 | 优先抽出 Agent Runtime，Chat 只保留会话和 SSE |
| MCP 获得过高系统权限 | HTTP 优先、管理员配置、工具白名单、网络策略、Secret 隔离 |
| Skills 互相冲突或撑爆上下文 | 固定 Prompt 优先级、数量限制、Token 预算、最终 Prompt 预览 |
| Run 日志保存敏感内容 | Preview 截断、字段脱敏、受限权限和保留周期 |
| Tool/MCP 循环失控 | 最大轮数、调用数、并发、总时长和总输出限制 |
| Knowledge 任务阻塞 API | PostgreSQL 任务表、后台 Worker、重试和恢复 |
| Agent 配置更新导致线上漂移 | 不可变 AgentVersion 和显式发布 |
| Subagent 成本和权限扩散 | 深度 1、固定关系、权限不提升、父 Run 总预算 |

## 14. 结论

Mia 下一阶段最重要的建设不是立即增加更多 Agent 能力，而是先形成：

```text
统一 Agent Runtime
+ 完整 Run Trace
+ 稳定模型调用
+ 可恢复 Knowledge 索引
+ 安全 Tool Policy
```

完成这些基础后，再增加 MCP 和 Skills，才能保证外部能力可控、问题可定位、配置可复用。成熟路线应保持：

```text
V1 稳定运行
-> V2 扩展能力
-> V3 评估和治理
-> V4 复杂任务
```

这一路线既覆盖成熟 Agent 平台需要的关键能力，也避免 Mia 在早期演变为难以维护的 Workflow 或开放插件平台。
