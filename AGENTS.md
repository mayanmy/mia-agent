# AGENTS.md

## 项目概述

Mia 是一个面向团队内部使用的 AI Agent 开发平台，目标用户规模为 20-50 人，由一个人开发和维护，采用本地部署。

### 产品定位

- Mia 是一个轻量、本地可控的内部 Agent + RAG 工作台。
- 核心目标是让团队成员可以创建、配置和使用带知识库的 AI 助手。
- 第一版优先完成从“配置模型和知识库”到“创建 Agent、对话使用、日志排查”的最小闭环。

### 做什么

- 支持用户登录和基础权限，先区分 Admin/User。
- 支持创建和管理 Agent，包括名称、描述、系统 Prompt、模型和知识库绑定。
- 支持统一 Chat 界面，提供流式 SSE 对话输出。
- 支持知识库管理，包括文档上传、解析、切分、Embedding 和向量检索。
- 支持基于 RAG 的回答生成，并展示基础来源引用。
- 支持对话日志、错误日志和基本用量统计，方便排查回答质量和系统问题。
- 支持少量内置工具调用，第一版控制范围，避免做开放式插件系统。

### 不做什么

- 不做 Dify 式完整可视化 Workflow/Chatflow 编排。
- 不做插件市场、应用市场、模板市场或开放插件生态。
- 不做多租户 Workspace，第一版按单团队单空间设计。
- 不做复杂 RBAC，第一版只保留 Admin/User。
- 不做计费、套餐、商业化能力。
- 不做语音、图像生成、多模态等非核心能力。
- 不做复杂评测、A/B 测试和高级实验平台。
- 不优先做对外 API 发布、Web 嵌入组件和 MCP 发布。

### 技术栈

- Frontend: React + TypeScript + Vite。
- Backend: Node.js + NestJS + TypeScript。
- 本仓库本地开发和验证默认使用 Node.js 22；运行 `npm`、`node`、前后端 build/test/dev 命令时必须确保使用 Node 22，不使用系统旧版 Node 16。
- Database: PostgreSQL + pgvector。
- Storage: 本地文件存储，后续可按需要替换为 MinIO。
- AI: OpenAI-compatible Chat/Embedding API。
- RAG: 第一版手写最小 RAG 流程，先不引入复杂 Agent 框架。
- Deployment: Docker Compose 本地部署。

### 部署与运维预期

- Mia v0.1 不按高 QPS 系统设计，重点关注 SSE 长连接、LLM 慢响应、请求取消、限流和日志排查。
- 目标容量：普通 API 20 QPS 以上，SSE 并发 30-50，全局 LLM 并发 5-10 起步。
- 对话接口需要支持流式 SSE、心跳、超时控制、用户取消和失败状态记录。
- 缓存优先覆盖 Agent 配置、模型配置、用户权限、文件解析结果、chunks 和 embeddings；第一版不缓存最终 LLM 回答。
- 文档解析和向量化应后台执行，避免阻塞 API 请求。
- 本地部署需要提前考虑 PostgreSQL 备份、上传文件备份、环境变量备份和日志归档。
- 反向代理需要正确支持 SSE：关闭响应缓冲、提高 read timeout、保持长连接，不压缩 text/event-stream。

## 代码组织规范

Mia 后端采用模块化单体架构。代码运行在一个 NestJS 服务内，但内部必须按业务模块隔离，避免全局 service、跨模块随意查表和循环依赖。

### 后端目录结构

后端代码必须按以下结构组织：

```text
backend/
  src/
    main.ts
    app.module.ts
    core/
      config.ts
      result.ts
      result.interceptor.ts
      errors.ts
      pagination.ts
    modules/
      auth/
        auth.module.ts
        auth.controller.ts
        auth.service.ts
        dto/
      users/
        users.module.ts
        users.controller.ts
        users.service.ts
        dto/
      model_providers/
        model-providers.module.ts
        model-providers.controller.ts
        model-providers.service.ts
        dto/
        clients/
      agents/
        agents.module.ts
        agents.controller.ts
        agents.service.ts
        dto/
      knowledge/
        knowledge.module.ts
        knowledge.controller.ts
        knowledge.service.ts
        dto/
        parsing.ts
        chunking.ts
      retrieval/
        retrieval.module.ts
        retrieval.service.ts
        dto/
        vector-store.ts
        embedding.ts
      chat/
        chat.module.ts
        chat.controller.ts
        chat.service.ts
        dto/
        sse.ts
      tools/
        tools.module.ts
        tools.service.ts
        dto/
        registry.ts
        builtin/
      logs/
        logs.module.ts
        logs.controller.ts
        logs.service.ts
        dto/
      prisma/
        prisma.module.ts
        prisma.service.ts
    jobs/
      document-indexing.job.ts
  prisma/
    schema.prisma
    migrations/
  test/
```

新增业务能力时，优先放入已有模块。只有当它有独立数据模型、独立业务生命周期、独立权限边界时，才新增模块。

### 模块内部标准分层

每个模块最多使用以下文件类型。不要发明新的层名，除非该模块已有明确复杂度需要拆分。

| 文件 | 职责 | 可以依赖 | 禁止做什么 |
| --- | --- | --- | --- |
| `*.module.ts` | 声明 NestJS 模块、controller、provider 和导出项 | 本模块 controller/service、允许依赖的模块 | 不写业务逻辑；不直接查库 |
| `*.controller.ts` | 定义 HTTP 路由、解析请求、声明鉴权、返回 DTO | 本模块 `dto/`、`*.service.ts`，`core` 鉴权依赖 | 不写业务逻辑；不直接操作数据库；不直接调用外部 LLM；不拼 RAG Prompt |
| `dto/` | 定义请求、响应、跨模块 DTO 类型 | TypeScript 类型、class DTO | 不访问数据库；不调用 service；不包含业务流程 |
| `*.service.ts` | 实现本模块业务逻辑和对外公开用例 | 本模块文件、允许依赖的其他模块 service、`core` | 不处理 HTTP 细节；不直接读取环境变量 |
| `clients/` | 封装外部服务客户端，例如模型服务客户端 | `core/config`、具体 SDK | 不写业务编排；不访问业务表 |
| `parsing.ts` / `chunking.ts` | 文档解析、切分等纯处理逻辑 | 标准库、第三方解析库、本模块 DTO | 不访问数据库；不调用 LLM；不写任务状态 |
| `sse.ts` | 封装 SSE 事件格式、心跳、流式响应辅助 | `chat/dto`、`core/errors` | 不加载 Agent；不检索知识库；不直接查库 |
| `registry.ts` | 注册和查找工具、Provider 等可插拔对象 | 本模块 DTO、具体实现 | 不执行跨模块业务流程 |

### 每一层必须遵守的职责边界

#### Controller 层

- 每个接口只做四件事：接收请求、获取当前用户、调用 service、返回 response DTO。
- Controller 不允许出现 Prisma 查询、LLM 调用、Embedding 调用、文件解析、向量检索。
- Controller 不允许 import 其他模块的 Prisma 内部实现。
- Controller 可以使用 Guard/Decorator 获取当前用户。

示例：

```typescript
@Post()
async createAgent(
  @Body() payload: AgentCreateDto,
  @CurrentUser() currentUser: CurrentUser,
): Promise<AgentDetail> {
  return this.agentsService.createAgent(currentUser.id, payload);
}
```

#### DTO 层

- 所有 API 输入输出必须定义在 `dto/`。
- 请求 DTO 使用 `CreateDto`、`UpdateDto`、`QueryDto` 后缀。
- 响应 DTO 使用 `ListItem`、`Detail`、`Response` 后缀。
- 跨模块 service 调用如需传递复杂数据，必须定义明确 DTO，不直接传 ORM model。
- DTO 不允许 import service 或 Prisma client。

#### Prisma 层

- 数据表定义统一放在 `backend/prisma/schema.prisma`。
- 其他模块不允许绕过所属模块 service 直接读写外部模块的数据。
- 关联表归属调用方模块。例如 Agent 绑定知识库的关系表属于 `agents` 模块，因为绑定关系是 Agent 配置的一部分。
- Prisma schema 只定义数据结构、关系、索引和约束，不承载业务逻辑。

#### Service 层

- Service 是模块唯一允许承载业务逻辑的层。
- 跨模块调用只能调用对方模块 `*.service.ts` 中明确暴露的方法，不能跨模块直接查表。
- Service 入参和返回值优先使用 schema/DTO、基础类型、ID，不返回外部模块 ORM model。
- Service 不允许 import `*.controller.ts`。
- Service 不处理 HTTP 响应包装细节，业务错误统一抛出 `core/errors` 中定义的异常。

#### Jobs 层

- `jobs/` 是后台任务编排层，可以依赖多个模块 service。
- 业务模块不允许依赖 `jobs/`。
- 文档解析、切分、Embedding、重建索引必须由 job 编排，不能在上传接口里同步跑完整流程。
- Job 必须记录任务状态和错误日志。

#### Integrations 层

- `integrations/` 只封装第三方协议和 SDK，例如 OpenAI-compatible API。
- Integrations 不知道 Mia 的 Agent、Knowledge、Chat、User 等业务概念。
- 业务模块通过 `model_providers.service` 或 `retrieval.service` 间接使用 integrations，不直接散落调用第三方 SDK。

### 跨模块调用规则

跨模块调用必须遵守固定依赖方向：

```text
core
users
auth -> users
model_providers -> core
knowledge -> core
retrieval -> knowledge, model_providers
agents -> knowledge, model_providers
tools -> core
chat -> agents, retrieval, model_providers, tools, logs
logs -> core
jobs -> knowledge, retrieval, logs
```

允许的跨模块调用：

| 调用方 | 允许调用 |
| --- | --- |
| `auth` | `users.service` |
| `agents` | `knowledge.service`、`model_providers.service` |
| `retrieval` | `knowledge.service`、`model_providers.service` |
| `chat` | `agents.service`、`retrieval.service`、`model_providers.service`、`tools.service`、`logs.service` |
| `jobs` | `knowledge.service`、`retrieval.service`、`logs.service` |

禁止的跨模块调用：

| 禁止关系 | 原因 |
| --- | --- |
| `knowledge -> retrieval` | 避免文档模块和检索模块循环依赖 |
| `agents -> chat` | Agent 配置不能依赖会话实现 |
| `logs -> chat` | 日志模块不能反向读取对话模块 |
| `model_providers -> retrieval` | 模型配置不能知道检索业务 |
| `tools -> chat` | 工具只返回结果，不能操作会话 |
| `users -> agents/chat/logs` | 用户模块必须保持底层稳定 |

### 跨模块数据访问规则

- 一个模块只能直接查询自己模块的表。
- 如果需要读取其他模块数据，必须通过对方模块 service 暴露的查询函数。
- 如果列表页需要组合多个模块的数据，优先在上层 service 编排，不把组合逻辑塞进底层模块。
- 允许日志表冗余必要展示字段，例如 `agent_name`、`user_email`、`message_preview`，以避免 `logs -> chat/agents/users` 的反向依赖。
- 外键可以跨模块存在，但 ORM 查询和业务逻辑仍归属各自模块 service。

### AI/RAG 相关边界

- `chat` 负责编排一次对话：加载 Agent、检索知识、调用模型、处理 SSE、写日志。
- `agents` 只负责 Agent 配置，不拼接完整对话 Prompt，不调用 LLM。
- `knowledge` 只负责知识库、文档、chunk 的生命周期，不生成 embedding，不执行向量检索。
- `retrieval` 负责 embedding、向量检索和 RAG context 构造。
- `model_providers` 负责模型配置和模型调用能力，不知道具体业务场景。
- `tools` 负责工具定义、参数校验和执行，不能直接写 chat message。
- 最小 RAG 流程必须保持为：

```text
chat.service
  -> agents.service 获取 Agent 配置
  -> retrieval.service 获取 RAG context
  -> model_providers.service 调用 Chat Model
  -> logs.service 记录结果
```

### SSE 对话接口规范

- SSE 只能由 `chat` 模块提供。
- SSE 事件类型固定使用：`message_start`、`retrieval_start`、`retrieval_result`、`token`、`tool_call`、`tool_result`、`message_end`、`error`、`ping`。
- `chat.service` 必须检测客户端断开，并取消上游 LLM stream。
- 单次对话必须记录 `request_id`、`user_id`、`agent_id`、`session_id`、耗时、错误、检索片段和模型信息。
- SSE 事件格式必须在 `chat/dto/` 或 `chat/sse.ts` 中统一定义，不允许各接口手写字符串格式。

### 命名规则

- 模块目录使用小写蛇形命名，例如 `model_providers`。
- 数据库表名使用复数蛇形命名，例如 `agents`、`knowledge_documents`。
- 主键统一使用 `id`。
- 外键命名使用 `{entity}_id`，例如 `agent_id`、`knowledge_base_id`。
- Service 函数使用动词开头，例如 `create_agent`、`get_agent_detail`、`stream_chat_message`。
- Router 文件中路由函数名称必须和 service 用例对应，不能使用 `handle`、`process` 这类泛名。

### 新增功能时的执行步骤

新增任何功能时，按以下顺序执行：

1. 判断功能归属哪个模块。
2. 如果涉及跨模块数据，先确认是否已有 service 可用。
3. 在所属模块 `dto/` 定义输入输出结构。
4. 如需新表，在 `backend/prisma/schema.prisma` 定义模型和索引。
5. 在所属模块 `*.service.ts` 实现业务逻辑。
6. 在所属模块 `*.controller.ts` 暴露 API。
7. 如需后台处理，在 `jobs/` 新增任务编排。
8. 如需调用外部模型或服务，先封装到 `integrations/` 或对应 provider。
9. 补充最小测试，覆盖 service 主路径和关键失败路径。

### 禁止事项

- 禁止创建全局 `services/`、`models/`、`schemas/` 目录承载业务代码。
- 禁止模块之间绕过对方 service 直接读写对方数据。
- 禁止在 router 中写业务流程。
- 禁止在 model 中写业务流程。
- 禁止让底层模块依赖 `chat` 或 `jobs`。
- 禁止在多个模块中重复实现同一个业务概念。
- 禁止为了未来扩展提前拆微服务。

## 未来拆服务准备

Mia 一期采用模块化单体，不提前拆微服务。但代码必须为未来按模块拆成独立服务预留边界。目标是：未来拆服务时主要改调用方式，不重写业务逻辑。

### 当前必须遵守的准备项

| 准备项 | 当前做法 | 未来拆服务时的收益 |
| --- | --- | --- |
| 跨模块只通过 service 调用 | 调用其他模块时只依赖对方 module 导出的 service 方法 | 可替换为 HTTP/gRPC client |
| 不跨模块传 ORM model | service 入参和返回值使用 ID、基础类型、TypeScript DTO | DTO 可直接变成远程 API schema |
| 不跨模块直接查表 | 每个模块只查询自己的表 | 数据库可按服务拆分 |
| 定义运行时配置 DTO | 如 `AgentRuntimeConfig`、`ModelRuntimeConfig`、`RetrievalContext` | 高频配置读取可远程化和缓存 |
| 统一 request_id | 每次请求进入系统时生成并贯穿日志、SSE、任务 | 未来跨服务链路追踪 |
| 统一错误模型 | 业务错误使用 `core.errors`，对外返回固定错误结构 | 未来跨服务错误可映射 |
| 隔离外部 SDK | OpenAI-compatible、文件存储等只放在 `integrations/` 或对应 provider | 替换供应商或拆服务时不影响业务模块 |
| 抽象文件存储 | 文件读写必须通过 storage service，不直接散落使用本地路径 | 本地 volume 可切换 MinIO/S3 |
| 后台任务独立编排 | 文档索引、Embedding、重建索引用 `jobs/` 编排 | 未来可迁移到独立 worker 服务 |
| 日志写入弱依赖 | 主流程调用日志失败不能导致对话失败 | 日志服务可异步化或独立部署 |

### DTO 要求

跨模块返回的数据必须是明确 DTO，不允许返回外部模块 ORM 对象。

推荐定义这些运行时 DTO：

```text
agents.schemas.AgentRuntimeConfig
  - id
  - name
  - system_prompt
  - model_provider_id
  - model_name
  - knowledge_base_ids
  - enabled_tool_ids
  - generation_params

model_providers.schemas.ModelRuntimeConfig
  - provider_id
  - provider_type
  - base_url
  - model_name
  - model_type
  - timeout_seconds
  - max_tokens

retrieval.schemas.RetrievalContext
  - query
  - chunks
  - sources
  - elapsed_ms

logs.schemas.LogEvent
  - request_id
  - user_id
  - agent_id
  - session_id
  - event_type
  - payload
  - created_at
```

规则：

- DTO 可以新增字段，但删除字段必须确认所有调用方。
- DTO 字段名使用稳定业务语义，不暴露数据库内部实现。
- 跨模块 DTO 不包含 Prisma 原始结果对象、数据库事务对象、文件句柄或 SDK client。
- DTO 中如果包含敏感配置，例如 API key，只允许在模块内部使用，不允许返回给通用调用方。

### 可远程化接口约束

每个模块的 service 函数要按未来可远程 API 的方式设计：

```python
async def get_agent_runtime_config(
    session: AsyncSession,
    agent_id: UUID,
    user_id: UUID,
) -> AgentRuntimeConfig:
    ...
```

必须满足：

- 输入参数可 JSON 序列化，数据库 session 除外。
- 返回值可 JSON 序列化。
- 函数名表达业务用例，不表达数据库操作细节。
- 不要求调用方理解本模块内部表结构。
- 不把多个无关用例塞进一个 `process`、`handle`、`execute` 函数。

### 数据归属规则

未来拆服务时，数据表会跟随模块迁移。因此当前必须明确表归属：

| 数据 | 所属模块 |
| --- | --- |
| 用户、角色、禁用状态 | `users` |
| 登录凭证、token/session | `auth` |
| 模型供应商、模型配置 | `model_providers` |
| Agent 配置、Prompt、知识库绑定、工具绑定 | `agents` |
| 知识库、文档、chunk、文档状态 | `knowledge` |
| embedding、向量索引相关数据 | `retrieval` |
| 会话、消息、SSE 状态 | `chat` |
| 对话日志、错误日志、用量事件 | `logs` |

规则：

- 表只能由所属模块 service 写入。
- 其他模块需要数据时，通过所属模块 service 读取。
- 允许跨模块外键，但不能因为有外键就跨模块直接 join。
- 统计页需要多模块数据时，由上层编排 service 聚合，或通过日志冗余字段解决。

### request_id 与日志规范

- 每个 HTTP 请求必须有 `request_id`。
- 如果客户端传入合法 `X-Request-ID`，沿用它；否则服务端生成。
- `request_id` 必须写入：
  - API 访问日志
  - SSE 对话日志
  - LLM 调用日志
  - Retrieval 日志
  - 后台任务日志
  - 错误日志
- 跨模块 service 调用必须显式传递 `request_id` 或通过统一 request context 获取。
- 后续拆服务时，`request_id` 作为跨服务追踪 ID 使用。

### 可优先拆出的模块

未来如果需要拆服务，优先顺序如下：

1. `model_providers`：模型调用和配置边界清晰，适合独立成模型网关。
2. `logs`：写入型为主，适合异步化和独立存储。
3. `tools`：工具执行接口清晰，适合独立沙箱或工具服务。
4. `retrieval`：当向量检索和 embedding 压力变大时拆出。
5. `knowledge`：当文档处理、文件存储、索引任务复杂后拆出。
6. `chat`：当 SSE 长连接和对话编排成为主要瓶颈时拆出。

不优先拆：

- `auth` / `users`。这是横切基础能力，拆出会影响所有模块。除非接入企业 SSO/OIDC，否则保持在主服务内。

### 拆服务前禁止提前做的事

- 禁止为了未来拆服务提前引入微服务框架。
- 禁止在一期引入服务发现、API 网关、分布式事务。
- 禁止把每个模块都拆成独立数据库。
- 禁止为了“未来可能需要”提前抽象所有接口。
- 禁止把简单本地函数调用包装成复杂 RPC 层。

当前只需要守住三件事：

1. 模块边界清晰。
2. DTO 明确稳定。
3. 跨模块只通过 service 调用。

## 外部 LLM 调用规范

Mia 后续需要调用多个外部 LLM API，例如 OpenAI、Claude、Gemini、Ollama。所有外部模型调用都必须当成慢且不稳定的远程系统处理，统一做并发隔离、超时、重试、熔断、取消和日志。

### 统一调用入口

业务模块禁止直接调用外部 LLM SDK 或 HTTP API。所有 Chat、Embedding、Rerank 等模型调用必须走：

```text
业务模块
  -> model_providers.service
    -> model_providers.gateway
      -> ProviderClient(OpenAI / Claude / Gemini / Ollama)
```

推荐目录：

```text
backend/src/modules/model-providers/
  model-providers.module.ts
  model-providers.controller.ts
  model-providers.service.ts
  gateway.ts
  circuit-breaker.ts
  retry.ts
  timeout.ts
  rate-limit.ts
  dto/
  clients/
    base.client.ts
    openai.client.ts
    claude.client.ts
    gemini.client.ts
    ollama.client.ts
```

`chat`、`retrieval`、`tools` 等模块只允许调用 `model_providers.service`，不允许知道具体供应商 SDK。

### 对外能力接口

`model_providers.service` 至少暴露以下能力：

```python
async def stream_chat_completion(...) -> AsyncIterator[LLMStreamEvent]:
    ...

async def create_chat_completion(...) -> LLMResponse:
    ...

async def create_embedding(...) -> EmbeddingResponse:
    ...
```

规则：

- 入参和返回值必须是 TypeScript DTO 或基础类型。
- 不返回第三方 SDK 原始对象。
- 不把 API key、完整 provider secret 返回给调用方。
- Provider 差异在 client 层消化，对上层暴露统一事件和错误类型。

### 线程与并发管理

- NestJS 中调用外部 LLM API 优先使用 `fetch`、`undici` 或官方 SDK 的异步接口。
- 禁止为每个 LLM 请求手动创建线程。
- 外部 HTTP 调用必须复用 async client，不能每次请求新建无管理的 client。
- 每个 provider 必须有独立并发限制，避免单个供应商拖垮全部模型调用。
- 全局 LLM 调用也必须有并发限制。

推荐初始并发：

```text
global_llm_concurrency: 20
openai_concurrency: 10
claude_concurrency: 5
gemini_concurrency: 5
ollama_concurrency: 3
embedding_concurrency: 5
```

实现上使用 provider 级并发队列、轻量 semaphore 或等价机制：

```text
获取 provider semaphore
-> 发起请求
-> 流式读取或等待响应
-> 完成/失败/取消
-> 释放 semaphore
```

### 请求取消

SSE 用户断开或点击停止生成时，必须取消上游 LLM 调用。

要求：

- `chat.service` 检测客户端断开。
- 取消当前 LLM stream task。
- 关闭上游 HTTP stream。
- 释放 provider semaphore。
- 写入 `canceled` 状态日志。
- 不继续消耗模型 token。

### 超时策略

LLM 调用必须分层设置超时，禁止只设置一个总 timeout。

推荐默认值：

| 阶段 | 默认值 |
| --- | --- |
| 获取并发槽位 | 5-10 秒 |
| 建立连接 | 5-10 秒 |
| 请求写入 | 10 秒 |
| 首 token 等待 | 15-30 秒 |
| token 间隔空闲 | 30-60 秒 |
| 流式 Chat 总时长 | 120-180 秒 |
| 非流式 Chat 总时长 | 60-120 秒 |
| Embedding 请求 | 30-60 秒 |
| Ollama 本地模型 | 180-300 秒 |

配置优先级：

```text
全局默认 timeout
-> provider timeout
-> model timeout
-> agent override
-> 单次请求 override
```

SSE 心跳建议每 15-30 秒发送一次 `ping` 事件。

### 错误分类

模型调用错误必须分类，禁止统一吞成 `LLM failed`。

| 错误类型 | 是否重试 | 处理方式 |
| --- | --- | --- |
| 网络连接失败 | 可重试 | 记录 provider/network 错误 |
| 读超时 | 可重试 | 流式已输出 token 后不重试 |
| 429 rate limit | 可重试 | 尊重 `Retry-After`，并做退避 |
| 500/502/503/504 | 可重试 | 指数退避后重试 |
| 400 参数错误 | 不重试 | 返回配置或请求错误 |
| 401/403 鉴权失败 | 不重试 | 标记 provider 配置异常 |
| 上下文超长 | 不重试 | 触发上下文裁剪或返回明确错误 |
| 用户取消 | 不重试 | 记录 canceled |
| 内容安全拦截 | 不重试 | 返回安全拦截原因 |

### 重试策略

重试必须按调用类型区分：

| 调用类型 | 重试规则 |
| --- | --- |
| Embedding | 可重试 2-3 次 |
| 非流式 Chat | 首次失败且未返回内容时可重试 1-2 次 |
| 流式 Chat 首 token 前失败 | 可重试 1-2 次 |
| 流式 Chat 已输出 token 后失败 | 不重试 |
| 工具调用后的 LLM 继续生成 | 谨慎重试，避免重复执行工具 |
| 400/401/403/上下文超长/用户取消 | 不重试 |

退避策略必须使用指数退避 + jitter：

```text
第 1 次：0.5-1 秒
第 2 次：1-2 秒
第 3 次：2-4 秒
```

如果外部 API 返回 `Retry-After`，优先使用它，但必须设置上限：

```text
max_retry_after: 30 秒
```

### 熔断与降级

每个 provider 必须维护健康状态：

```text
healthy
degraded
unavailable
```

熔断状态：

```text
closed -> open -> half_open -> closed
```

建议触发规则：

- 连续失败 5 次进入 `open`。
- `open` 后冷却 60 秒。
- 冷却后进入 `half_open`。
- 探测请求成功后恢复 `closed`。
- 探测失败则重新进入 `open`。

Fallback 规则：

- 首 token 前失败，可以切换到备用模型或备用供应商。
- 首 token 后失败，不允许自动切换模型继续生成。
- Fallback 是否启用必须由 Agent 或模型配置决定，不能隐式跨模型切换。

### Provider 配置项

每个 provider/model 至少支持以下配置：

```text
provider_type
base_url
api_key_encrypted
default_model
enabled
priority
max_concurrency
connect_timeout
first_token_timeout
idle_timeout
total_timeout
max_retries
retry_backoff_base
circuit_breaker_failures
circuit_breaker_cooldown
fallback_provider_id
fallback_model_name
```

敏感字段必须加密存储或至少避免明文展示。

### 日志与指标

每次模型调用必须记录：

```text
request_id
provider
model
agent_id
user_id
streaming
retry_count
fallback_used
first_token_ms
total_ms
prompt_tokens
completion_tokens
status
error_type
error_message
canceled_by_user
```

Provider 级指标至少包括：

```text
成功率
失败率
429 次数
超时次数
平均首 token 延迟
P95 首 token 延迟
平均总耗时
P95 总耗时
当前并发数
熔断状态
```

### v0.1 最小实现要求

Mia v0.1 至少实现：

1. 所有 LLM 调用统一走 `model_providers.gateway`。
2. 每个 provider 一个独立并发限制器。
3. 每个请求有 connect、first token、idle、total timeout。
4. Embedding 可重试 2-3 次。
5. 流式 Chat 只在首 token 前重试。
6. 用户取消必须关闭上游 stream。
7. 连续失败触发简单 circuit breaker。
8. LLM 日志记录 retry、timeout、provider、model、first_token_ms 和 error_type。

## 数据库性能规范

Mia 使用 PostgreSQL + pgvector。建表、加字段、写查询时必须优先考虑索引、分页、大表增长和通用字段一致性。

### 通用字段约定

所有业务表默认包含以下字段，除非是纯关联表或特殊日志明细表：

```text
id
created_at
updated_at
deleted_at
```

规则：

- `id` 使用 UUID，作为主键。
- `created_at` 必须建索引，常用于列表倒序和时间范围查询。
- `updated_at` 用于变更追踪，不默认单独建索引。
- `deleted_at` 用于软删除；业务查询默认过滤 `deleted_at IS NULL`。
- 需要软删除的表，唯一约束必须考虑 `deleted_at IS NULL` 的部分唯一索引。
- 日志类大表不强制软删除，优先用归档或按时间清理。

推荐字段类型：

```text
id: UUID primary key
created_at: timestamptz not null
updated_at: timestamptz not null
deleted_at: timestamptz nullable
```

常见审计字段：

```text
created_by
updated_by
deleted_by
```

规则：

- 用户可创建或修改的配置表必须包含 `created_by`。
- 需要展示“谁最后修改”的表包含 `updated_by`。
- 软删除且需要审计的表包含 `deleted_by`。

### 命名约定

- 表名使用复数蛇形命名，例如 `agents`、`knowledge_documents`。
- 主键统一命名为 `id`。
- 外键统一命名为 `{entity}_id`，例如 `agent_id`、`knowledge_base_id`。
- 索引命名使用 `idx_{table}_{columns}`。
- 唯一索引命名使用 `uq_{table}_{columns}`。
- 外键约束命名使用 `fk_{table}_{column}`。

### 索引设计原则

建表时必须根据查询路径预先创建索引。禁止只建主键就结束。

每个表至少检查以下索引：

1. 主键索引：`id`。
2. 外键索引：所有 `{entity}_id` 字段。
3. 列表查询索引：常用过滤条件 + `created_at DESC`。
4. 软删除索引：常用查询必须覆盖 `deleted_at IS NULL`。
5. 状态查询索引：高频按 `status` 查询的表。
6. 唯一约束索引：名称、编码、外部 ID 等唯一字段。

索引规则：

- 所有外键字段必须建索引。
- 所有高频列表页必须有匹配的复合索引。
- 复合索引字段顺序遵守：等值过滤字段在前，范围/排序字段在后。
- 高频软删除表优先使用部分索引：`WHERE deleted_at IS NULL`。
- 不为低基数字段单独建索引，例如单独的 `status`、`role`，除非和其他字段组成复合索引。
- 不为大文本字段建普通 B-tree 索引。
- 不创建没有明确查询场景的索引。

示例：

```sql
-- Agent 列表：按创建者筛选并按创建时间倒序
CREATE INDEX idx_agents_created_by_created_at
ON agents (created_by, created_at DESC)
WHERE deleted_at IS NULL;

-- 会话列表：按用户和 Agent 查询
CREATE INDEX idx_chat_sessions_user_agent_created_at
ON chat_sessions (user_id, agent_id, created_at DESC);

-- 文档任务：按知识库和状态查询
CREATE INDEX idx_knowledge_documents_kb_status_created_at
ON knowledge_documents (knowledge_base_id, status, created_at DESC)
WHERE deleted_at IS NULL;
```

### 推荐核心索引

Mia v0.1 建表时至少考虑以下索引：

```text
users
  uq_users_email WHERE deleted_at IS NULL
  idx_users_created_at

user_sessions
  idx_user_sessions_user_id_created_at
  idx_user_sessions_expires_at

model_providers
  idx_model_providers_enabled_created_at

model_configs
  idx_model_configs_provider_id
  idx_model_configs_type_enabled

agents
  idx_agents_created_by_created_at
  idx_agents_model_config_id
  uq_agents_name_created_by WHERE deleted_at IS NULL

agent_knowledge_bases
  uq_agent_knowledge_bases_agent_id_knowledge_base_id
  idx_agent_knowledge_bases_knowledge_base_id

agent_tools
  uq_agent_tools_agent_id_tool_id
  idx_agent_tools_tool_id

knowledge_bases
  idx_knowledge_bases_created_by_created_at
  idx_knowledge_bases_embedding_model_config_id
  uq_knowledge_bases_name_created_by WHERE deleted_at IS NULL

knowledge_documents
  idx_knowledge_documents_knowledge_base_id_created_at
  idx_knowledge_documents_knowledge_base_id_status_created_at
  idx_knowledge_documents_file_hash

knowledge_chunks
  idx_knowledge_chunks_document_id_chunk_index
  idx_knowledge_chunks_knowledge_base_id_created_at

knowledge_embeddings
  idx_knowledge_embeddings_chunk_id
  vector index on embedding

chat_sessions
  idx_chat_sessions_user_id_created_at
  idx_chat_sessions_agent_id_created_at
  idx_chat_sessions_user_agent_created_at

chat_messages
  idx_chat_messages_session_id_created_at
  idx_chat_messages_agent_id_created_at
  idx_chat_messages_user_id_created_at

message_references
  idx_message_references_message_id
  idx_message_references_chunk_id

llm_call_logs
  idx_llm_call_logs_created_at
  idx_llm_call_logs_user_id_created_at
  idx_llm_call_logs_agent_id_created_at
  idx_llm_call_logs_provider_model_created_at
  idx_llm_call_logs_request_id

error_logs
  idx_error_logs_created_at
  idx_error_logs_request_id
  idx_error_logs_error_type_created_at

audit_logs
  idx_audit_logs_created_at
  idx_audit_logs_user_id_created_at

background_jobs
  idx_background_jobs_status_created_at
  idx_background_jobs_document_id
  idx_background_jobs_job_type_status
```

### pgvector 索引规则

向量字段必须只存在于检索相关表，例如 `knowledge_embeddings`。

规则：

- 向量维度必须和 embedding 模型维度一致。
- 不同维度的 embedding 不允许混存在同一个 vector 字段中。
- 如果未来支持多个 embedding 模型维度，必须拆表或增加独立 embedding namespace。
- 小数据量时可以先不建近似索引；数据增长后必须建 HNSW 或 IVFFlat。
- 向量检索必须先按 `knowledge_base_id` 或可访问范围过滤，再做 topK。
- 检索返回必须带 `chunk_id`、score 和 source 信息。

推荐：

```text
< 50k chunks: 可先使用精确检索或简单向量索引
50k-500k chunks: 使用 HNSW
> 500k chunks: 评估独立向量库或分区
```

### 大表预判

以下表会最先变大，建表时必须按大表处理：

| 表 | 增长来源 | 风险 |
| --- | --- | --- |
| `chat_messages` | 每轮对话至少 2 条消息 | 会话历史查询变慢 |
| `llm_call_logs` | 每次模型调用 1 条或多条 | 日志统计变慢 |
| `error_logs` | 失败、超时、重试、任务错误 | 排障查询变慢 |
| `knowledge_chunks` | 文档切分后大量 chunk | RAG 检索和文档管理变慢 |
| `knowledge_embeddings` | 每个 chunk 对应 embedding | 向量检索和存储压力 |
| `background_jobs` | 文档处理、重建索引任务 | 状态轮询变慢 |

### 大表应对策略

v0.1 先不做复杂分库分表，但必须预留以下策略：

```text
chat_messages
  - 必须按 session_id + created_at 查询
  - 默认只加载最近 N 条
  - 老消息按时间归档或保留在原表

llm_call_logs
  - 必须按 created_at 查询和统计
  - 默认查询最近 7/30 天
  - 后续可迁移到 ClickHouse/Loki/ELK

error_logs
  - 必须按 created_at、request_id、error_type 查询
  - 后续按时间清理或归档

knowledge_chunks / knowledge_embeddings
  - 必须能按 document_id 删除和重建
  - 必须能按 knowledge_base_id 查询
  - 后续可迁移 retrieval 服务或独立向量库

background_jobs
  - 必须按 status 查询待处理任务
  - 已完成任务后续可按时间清理
```

当任一表超过以下规模时，必须重新评估索引和归档策略：

```text
chat_messages > 1,000,000
llm_call_logs > 1,000,000
knowledge_chunks > 500,000
knowledge_embeddings > 500,000
error_logs > 500,000
background_jobs > 200,000
```

### 分页查询规范

列表接口必须分页，禁止无上限返回。

默认规则：

- 默认 `page_size` 为 20。
- 最大 `page_size` 为 100。
- 管理后台导出可以单独设计异步导出任务，不允许一个接口返回全量。
- 所有列表必须有稳定排序，默认按 `created_at DESC, id DESC`。

分页方式：

| 场景 | 分页方式 |
| --- | --- |
| 小表管理页 | offset pagination 可接受 |
| 大表日志页 | cursor pagination |
| chat messages | cursor pagination |
| llm_call_logs | cursor pagination |
| error_logs | cursor pagination |
| knowledge_chunks | cursor pagination |

大表禁止深分页：

```text
禁止 OFFSET 超过 5000 的查询。
超过该范围必须使用 cursor pagination。
```

Cursor 规则：

```text
cursor = created_at + id
排序 = created_at DESC, id DESC
下一页条件 = (created_at, id) < (:cursor_created_at, :cursor_id)
```

分页查询必须只返回当前页面所需字段，不允许为了列表展示加载大文本字段，例如 chunk content、完整 prompt、完整 response。

### 查询编写规范

- 所有按用户、Agent、知识库、会话过滤的查询必须带对应索引字段。
- 软删除表默认加 `deleted_at IS NULL`。
- 大表查询必须带时间范围或 cursor。
- 日志统计默认限制时间范围，例如最近 7 天或最近 30 天。
- 列表页不要使用 `SELECT *`，只查展示字段。
- 不允许在 Node.js 内存中对大量数据做过滤、排序、分页；必须交给数据库完成。
- 避免 N+1 查询；需要展示关联名称时，优先使用冗余字段或明确的批量查询。
- 复杂统计不要放在对话主链路中执行。

### 迁移与变更规范

- 所有表结构变更必须通过 Prisma migration。
- 新增外键字段时必须同时考虑索引。
- 新增状态字段时必须确认是否需要和时间字段组成复合索引。
- 新增唯一约束时必须考虑软删除场景。
- 新增大文本字段时，列表查询不得默认返回该字段。
- 新增日志字段时，必须确认是否会显著增加写入量和存储量。

### 建表检查清单

AI 新建任何表时必须逐项确认：

1. 表属于哪个模块。
2. 是否需要 `created_at`、`updated_at`、`deleted_at`。
3. 是否需要 `created_by`、`updated_by`、`deleted_by`。
4. 哪些字段是外键，是否已建索引。
5. 主要列表查询是什么，是否有匹配复合索引。
6. 是否有软删除，唯一索引是否使用部分唯一索引。
7. 是否可能成为大表。
8. 如果是大表，是否使用 cursor pagination。
9. 是否包含大文本字段，列表查询是否避开。
10. 是否需要归档或清理策略。

## 接口规范

Mia 后端 API 采用 RESTful 风格，路径、响应结构、分页结构、空值返回和错误码必须保持统一。

### 路径规范

API 路径统一使用：

```text
/api/v1/{资源复数名}
```

资源名使用小写 kebab-case 或单个复数名。优先使用清晰的资源名，例如：

```text
/api/v1/providers
/api/v1/agents
/api/v1/knowledge-bases
/api/v1/chat-sessions
```

标准 CRUD 路径：

```text
GET    /api/v1/providers          # 列表（分页）
POST   /api/v1/providers          # 创建
GET    /api/v1/providers/{id}     # 详情
PUT    /api/v1/providers/{id}     # 更新
DELETE /api/v1/providers/{id}     # 删除
```

非 CRUD 操作用资源后接动词：

```text
POST /api/v1/providers/{id}/test-connection
POST /api/v1/agents/{id}/publish
POST /api/v1/knowledge-documents/{id}/reindex
POST /api/v1/chat-sessions/{id}/messages/stream
```

规则：

- 路径中资源必须使用复数名。
- 查询列表用 `GET`。
- 创建资源用 `POST`。
- 全量更新用 `PUT`。
- 删除资源用 `DELETE`，默认软删除。
- 非 CRUD 行为使用 `POST`，路径末尾使用动词。
- 不在路径中使用大写字母、下划线或动词式资源名。

### 统一响应

所有普通 JSON 接口必须返回 `Result<T>`：

```json
{
  "code": 200,
  "message": "success",
  "data": {}
}
```

规则：

- 成功时 `code` 固定为 `200`。
- 成功时 `message` 固定为 `success`，除非有明确业务提示。
- `data` 返回具体数据；无数据时返回 `null`。
- HTTP status 和业务 `code` 同时使用。业务失败时 HTTP status 必须使用合适的 4xx/5xx。
- SSE 接口不使用普通 `Result<T>` 包裹，SSE 事件内部仍必须使用统一事件结构。

### 分页规范

分页请求参数：

```text
page: 从 1 开始
pageSize: 默认 20，最大 100
```

分页响应统一返回 `Result<PageResult<T>>`：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "list": [],
    "total": 0,
    "page": 1,
    "pageSize": 20
  }
}
```

`PageResult<T>` 必须包含：

```text
list
total
page
pageSize
```

规则：

- `page` 小于 1 时返回参数错误。
- `pageSize` 未传时使用 20。
- `pageSize` 超过 100 时返回参数错误，不能静默放大查询。
- 普通管理页可以使用 page/pageSize。
- 大表日志、聊天消息、chunks 等使用 cursor pagination 时，必须单独定义 cursor 响应结构，不复用 `PageResult<T>`。

### 空值规范

接口返回空值必须遵守：

- 列表字段空时返回 `[]`，不返回 `null`。
- 字符串字段空时返回 `""`，不返回 `null`。
- 对象不存在或可选对象为空时返回 `null`。
- 数字字段无值时，如果业务上有默认值，返回默认值；没有默认值才返回 `null`。
- 布尔字段必须返回 `true` 或 `false`，不返回 `null`，除非业务上明确存在未知状态。

### 错误码规范

错误码使用四位数字，按模块分段：

```text
1000-1999 通用
2000-2999 Provider
3000-3999 Agent
4000-4999 Chat
5000-5999 MCP（预留）
6000-6999 Workflow（预留）
7000-7999 Knowledge
8000-8999 Auth/User
9000-9999 System/Infrastructure
```

规则：

- `200` 只表示成功。
- 业务错误必须返回四位数字错误码。
- 新增错误码必须归属明确模块。
- 不允许在代码中临时写魔法错误码。
- 错误响应也使用 `Result<null>` 结构。

错误响应示例：

```json
{
  "code": 3001,
  "message": "agent not found",
  "data": null
}
```

### 接口命名与 Schema 约定

- API 请求字段使用 camelCase，例如 `pageSize`、`providerType`。
- TypeScript 内部字段使用 camelCase。
- Prisma model 字段与 API DTO 字段默认使用 camelCase；数据库列名如需 snake_case，由 Prisma `@map` / `@@map` 显式声明。
- 列表响应 schema 使用 `{Resource}ListItem`。
- 详情响应 schema 使用 `{Resource}Detail`。
- 创建请求 schema 使用 `{Resource}Create`。
- 更新请求 schema 使用 `{Resource}Update`。
- 分页请求共用 `PageQuery`。
- 分页响应共用 `PageResult[T]`。

## 行为指令

### 写代码时

- 每个功能用最简单直接的方式实现。
- 不引入不必要的设计模式，除非用户明确要求。
- 不做过度抽象。
- 不引入技术栈以外的依赖；确实需要新增依赖时，必须先询问用户。
- 所有外部调用必须有超时设置。
- 配置项必须外化，不允许硬编码。

### 改代码时

- 先理解相关模块的设计意图，再修改代码。
- 不要为了新功能破坏已有接口契约。
- 改完后确保已有测试通过。

### 不确定时

- 架构选择必须给用户 2-3 个方案对比，由用户拍板。
- 规范没覆盖的情况，必须先问用户，不要自行编造新规矩。

## 接口契约设计 Skill

### 触发条件

当需要为一个新模块设计接口契约时使用。

### 执行步骤

1. 列出这个模块的核心业务操作，包括创建、查询、更新、删除和特殊操作。
2. 每个操作必须定义：
   - HTTP 方法
   - 路径
   - 入参
   - 出参
3. 路径必须遵循：

```text
/api/v1/{资源复数名}
```

4. 所有普通 JSON 接口必须返回 `Result<T>`。
5. 列表接口必须支持分页参数：

```text
page
pageSize
```

6. 删除接口必须标注是否需要关联检查。
7. 非 CRUD 操作必须使用动词路径，例如：

```text
POST /api/v1/providers/{id}/test-connection
```
