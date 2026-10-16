# 模型思考模式分层配置技术文档

## 1. 文档信息

- 文档状态：已实现
- 方案版本：V1.0
- 编写日期：2026-09-01
- 适用范围：Mia 模型配置、Agent 配置、Agent Runtime、OpenAI-compatible 模型调用与 Run Trace
- 对应迁移：`20260901000100_add_model_thinking_mode`、`20260901000200_add_agent_thinking_mode`

## 2. 背景

部分 OpenAI-compatible 推理模型默认启用思考模式。模型会先输出 `reasoning_content`，再输出用户可见的 `content`。如果 Mia 只读取 `content`，用户会长时间看不到首字，同时无法判断延迟来自网络、供应商排队还是模型内部推理。

实际观测中，`qwen3.7-max` 开启思考时出现以下数据：

```json
{
  "firstUpstreamEventMs": 746,
  "firstReasoningTokenMs": 746,
  "firstContentTokenMs": 20557,
  "reasoningObserved": true,
  "reasoningCharacterCount": 1918
}
```

这说明供应商很快开始返回数据，但正式内容在约 20 秒后才出现。关闭思考后，首 Token 降至约 890ms。

不同 Agent 对思考模式的需求不同：文案优化和简单问答重视响应速度，故障诊断和代码分析更重视推理质量。因此思考模式不能只配置在模型层，也不能只配置在 Agent 层。

本次实现采用以下分层：

```text
模型配置：声明是否支持思考覆盖，并提供默认思考模式
Agent 配置：选择跟随模型、开启或关闭
Agent Runtime：计算实际生效模式
Provider Client：转换为供应商请求参数
Run Trace：记录推理流与首内容 Token 遥测
```

## 3. 目标与非目标

### 3.1 目标

1. 模型配置明确声明是否支持显式开启或关闭思考。
2. 支持思考覆盖的模型可以设置模型默认模式。
3. 同一个模型可以被不同 Agent 以不同思考模式使用。
4. Agent 可以选择“跟随模型默认、开启思考、关闭思考”。
5. 不支持思考覆盖的模型不会收到供应商特有的思考参数。
6. 流式和非流式响应均能识别 `reasoning_content`。
7. 推理内容与最终回答分离，不把内部推理直接拼入用户可见内容。
8. Run Trace 可以判断首 Token 延迟是否由思考模式造成。

### 3.2 非目标

- 不向最终用户直接展示完整内部推理文本。
- 不自动根据用户问题复杂度开启或关闭思考。
- 不在本阶段实现按单次 Chat 请求覆盖思考模式的公开 UI。
- 不统一所有供应商的私有思考参数。
- 不实现“强制思考且不可关闭”的模型能力类型。

## 4. 核心设计

### 4.1 模型层负责能力与默认值

模型配置包含两个字段：

```text
thinkingSupported：模型是否支持由 Mia 显式覆盖思考模式
thinkingMode：模型默认思考模式
```

模型层配置含义：

| `thinkingSupported` | `thinkingMode` | 行为                                   |
| ------------------- | -------------- | -------------------------------------- |
| `false`             | `AUTO`         | 不发送思考覆盖参数，完全沿用供应商行为 |
| `true`              | `AUTO`         | Agent 跟随模型时，不发送覆盖参数       |
| `true`              | `ENABLED`      | Agent 跟随模型时显式开启思考           |
| `true`              | `DISABLED`     | Agent 跟随模型时显式关闭思考           |

关闭 `thinkingSupported` 时，服务端和前端都会把模型默认模式重置为 `AUTO`，避免出现“声明不支持覆盖但仍发送关闭参数”的矛盾配置。

### 4.2 Agent 层负责业务选择

Agent 保存 `thinkingMode`：

| Agent 配置 | 含义                    |
| ---------- | ----------------------- |
| `AUTO`     | 跟随模型默认配置        |
| `ENABLED`  | 当前 Agent 显式开启思考 |
| `DISABLED` | 当前 Agent 显式关闭思考 |

示例：

```text
qwen3.7-max
  thinkingSupported = true
  thinkingMode = DISABLED

文案优化 Agent
  thinkingMode = AUTO       -> 实际关闭

CI/CD 故障诊断 Agent
  thinkingMode = ENABLED    -> 实际开启
```

## 5. 数据模型

### 5.1 思考模式枚举

```prisma
enum ModelThinkingMode {
  AUTO     @map("auto")
  ENABLED  @map("enabled")
  DISABLED @map("disabled")

  @@map("model_thinking_mode")
}
```

### 5.2 模型配置字段

```prisma
model ModelConfig {
  thinkingMode      ModelThinkingMode @default(AUTO) @map("thinking_mode")
  thinkingSupported Boolean           @default(false) @map("thinking_supported")
}
```

### 5.3 Agent 配置字段

```prisma
model Agent {
  thinkingMode ModelThinkingMode @default(AUTO) @map("thinking_mode")
}
```

模型与 Agent 复用同一个枚举，但语义不同：模型的 `AUTO` 表示沿用供应商默认，Agent 的 `AUTO` 表示跟随模型配置。

## 6. 数据库迁移

### 6.1 模型级思考模式迁移

迁移 `20260901000100_add_model_thinking_mode`：

1. 创建 PostgreSQL 枚举 `model_thinking_mode`。
2. 在 `model_configs` 增加 `thinking_mode`。
3. 旧模型默认使用 `auto`，保持原有供应商行为。

### 6.2 Agent 分层配置迁移

迁移 `20260901000200_add_agent_thinking_mode`：

```sql
ALTER TABLE "model_configs"
ADD COLUMN "thinking_supported" BOOLEAN NOT NULL DEFAULT false;

UPDATE "model_configs"
SET "thinking_supported" = true
WHERE "thinking_mode" <> 'auto';

ALTER TABLE "agents"
ADD COLUMN "thinking_mode" "model_thinking_mode" NOT NULL DEFAULT 'auto';
```

兼容规则：

- 旧模型已显式配置 `enabled/disabled` 时，迁移后自动视为支持思考覆盖。
- 旧模型保持 `auto` 时，不假定模型支持思考。
- 所有旧 Agent 默认跟随模型配置。
- 迁移不改变旧 Agent 的实际调用行为。

部署脚本通过 `migrate` 容器自动执行 `prisma migrate deploy`，迁移成功后 API 才启动。

## 7. DTO 与 API

### 7.1 模型配置 DTO

模型列表、详情、创建、更新和 Agent 模型选项均包含：

```ts
type ModelThinkingConfig = {
  thinkingSupported: boolean;
  thinkingMode: "AUTO" | "ENABLED" | "DISABLED";
};
```

服务端创建规则：

```ts
thinkingMode = payload.thinkingSupported ? normalize(payload.thinkingMode ?? "AUTO") : "AUTO";
```

服务端更新规则：

```ts
if (payload.thinkingSupported === false) {
  thinkingMode = "AUTO";
}
```

非法枚举返回 `thinkingMode is invalid`，不允许任意字符串进入数据库或供应商请求。

### 7.2 Agent DTO

`AgentCreateDto`、`AgentUpdateDto`、`AgentDetail` 和 `AgentRuntimeConfig` 增加：

```ts
thinkingMode: ModelThinkingMode;
```

创建 Agent 未提供时默认为 `AUTO`。更新 Agent 未提供时保持原值。

## 8. 运行时解析

### 8.1 生效优先级

当前实现的优先级为：

```text
Agent 显式配置
  -> 模型默认配置
    -> 供应商默认行为
```

具体算法：

```ts
function resolveThinkingMode(
  agentMode: ModelThinkingMode,
  thinkingSupported: boolean,
  modelMode: ModelThinkingMode
): ModelThinkingMode {
  if (!thinkingSupported) return ModelThinkingMode.AUTO;
  return agentMode === ModelThinkingMode.AUTO ? modelMode : agentMode;
}
```

解析结果：

| 模型支持覆盖 | 模型默认   | Agent 配置 | 实际模式   |
| ------------ | ---------- | ---------- | ---------- |
| 否           | 任意       | 任意       | `AUTO`     |
| 是           | `AUTO`     | `AUTO`     | `AUTO`     |
| 是           | `DISABLED` | `AUTO`     | `DISABLED` |
| 是           | `ENABLED`  | `AUTO`     | `ENABLED`  |
| 是           | 任意       | `ENABLED`  | `ENABLED`  |
| 是           | 任意       | `DISABLED` | `DISABLED` |

### 8.2 调用链

```text
AgentsService.getAgentRuntimeConfig
  -> resolveThinkingMode
  -> AgentRuntime.streamChatCompletion
  -> ModelProvidersService
  -> ModelProvidersGateway.prepareChatCall
  -> OpenAICompatibleClient
```

Agent Runtime 传入的是实际生效模式，而不是 Agent 数据库原始值：

```ts
streamChatCompletion({
  modelConfigId: agent.modelConfigId,
  thinkingMode: agent.thinkingMode
  // messages、tools、temperature、timeout 等
});
```

Gateway 再次使用 `thinkingSupported` 做安全收口：

```ts
thinkingMode: modelConfig.thinkingSupported
  ? (request.thinkingMode ?? modelConfig.thinkingMode)
  : ModelThinkingMode.AUTO;
```

即使其他调用方错误地传入 `ENABLED`，模型未声明支持时也不会向供应商发送覆盖参数。

## 9. Provider 协议映射

当前显式启停只在 OpenAI-compatible Client 中实现，映射参数为 `enable_thinking`：

```ts
const body = {
  // model、messages、stream 等字段
  ...(config.thinkingMode === ModelThinkingMode.AUTO
    ? {}
    : {
        enable_thinking: config.thinkingMode === ModelThinkingMode.ENABLED
      })
};
```

最终请求行为：

| 实际模式   | 请求体                   |
| ---------- | ------------------------ |
| `AUTO`     | 不包含 `enable_thinking` |
| `ENABLED`  | `enable_thinking: true`  |
| `DISABLED` | `enable_thinking: false` |

`AUTO` 必须省略字段，不能等价发送 `false`，否则会改变已有模型的供应商默认行为。

其他 Provider 在没有完成私有协议映射前，应保持 `AUTO` 或忽略覆盖参数，不能直接假设均支持 `enable_thinking`。

## 10. reasoning_content 处理

### 10.1 流式响应

OpenAI-compatible Client 分别解析：

```text
delta.reasoning_content -> reasoning_token
delta.content           -> token
```

Runtime 只把 `token` 作为用户可见回答发送，`reasoning_token` 用于遥测，不拼接到正式内容。

### 10.2 非流式响应

非流式响应分别保存：

```ts
type ChatCompletionResponse = {
  content: string;
  reasoningContent?: string;
};
```

这样可以避免把内部推理与最终答案混合，同时保留供应商兼容能力。

### 10.3 不展示完整内部推理

当前 Mia 不向终端用户展示或持久化完整 `reasoning_content`。原因包括：

- 内部推理不等同于可靠事实来源。
- 可能包含冗余、自我修正或供应商内部表达。
- 完整记录可能放大敏感信息和存储风险。
- 性能诊断只需要时序与字符数，不需要全文。

## 11. Run Trace 遥测

`MODEL · chat_stream` Step 输出包含：

```json
{
  "telemetry": {
    "firstUpstreamEventMs": 746,
    "firstReasoningTokenMs": 746,
    "firstContentTokenMs": 20557,
    "reasoningObserved": true,
    "reasoningCharacterCount": 1918
  }
}
```

字段含义：

| 字段                      | 含义                               |
| ------------------------- | ---------------------------------- |
| `firstUpstreamEventMs`    | Mia 收到供应商首个非结束事件的耗时 |
| `firstReasoningTokenMs`   | 收到首个推理 Token 的耗时          |
| `firstContentTokenMs`     | 收到首个用户可见 Token 的耗时      |
| `reasoningObserved`       | 本次调用是否观察到推理内容         |
| `reasoningCharacterCount` | 接收到的推理字符总数，不保存正文   |

判断方式：

```text
firstUpstreamEventMs 很小
+ firstReasoningTokenMs 很小
+ firstContentTokenMs 很大
+ reasoningObserved = true
= 延迟主要来自模型思考阶段
```

关闭思考成功后，预期表现：

```json
{
  "reasoningObserved": false,
  "reasoningCharacterCount": 0,
  "firstContentTokenMs": 890
}
```

## 12. 前端交互

### 12.1 模型配置

Chat 模型显示：

```text
支持思考模式：[开关]
默认思考模式：[自动 / 默认开启 / 默认关闭]
```

交互规则：

1. 关闭“支持思考模式”时，将默认模式重置为 `AUTO`。
2. 不支持思考时，默认模式选择器禁用。
3. 模型列表显示“思考：自动/开启/关闭”或“不支持思考覆盖”。
4. Embedding 模型不展示思考配置。

### 12.2 Agent 配置

选择模型后展示：

```text
思考模式：[跟随模型默认 / 开启思考 / 关闭思考]
```

交互规则：

1. 只有所选模型 `thinkingSupported=true` 时允许选择。
2. 切换到不支持思考的模型时自动重置为 `AUTO`。
3. 编辑 Agent 时回填数据库保存的 Agent 原始配置，而不是运行时计算结果。
4. 页面说明当前选择会覆盖模型默认设置。

## 13. 错误与兼容策略

### 13.1 配置错误

- 非法 `thinkingMode`：请求失败，返回明确参数错误。
- 模型不支持覆盖：运行时强制使用 `AUTO`，不发送私有参数。
- Agent 从支持思考模型切换至不支持模型：前端重置为 `AUTO`，后端运行时仍有二次保护。

### 13.2 供应商不兼容

管理员只有在供应商兼容 `enable_thinking` 时才应打开“支持思考模式”。如果声明错误，供应商可能返回 HTTP 400。该错误按现有模型参数错误处理，不重试。

### 13.3 老数据兼容

- 原来显式开启或关闭的模型继续保持对应行为。
- 原来为自动的模型不被推断为支持覆盖。
- 旧 Agent 默认跟随模型，不改变调用结果。
- `reasoning_content` 缺失时按普通内容流处理，不影响非推理模型。

## 14. 安全与可观测性

1. 不在普通日志中记录完整 `reasoning_content`。
2. Run Trace 只记录推理是否出现、首推理 Token 和字符数。
3. `reasoning_content` 不拼入用户回答、工具参数或下一轮 assistant 正文。
4. API Key、Authorization 和供应商密钥不得出现在思考遥测中。
5. LLM 调用继续记录 `request_id`、`run_id`、模型配置、耗时和错误分类。
6. 用户取消生成时必须取消推理流，避免后台继续消耗 Token。

## 15. 已实现文件

### 数据库

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260901000100_add_model_thinking_mode/migration.sql`
- `backend/prisma/migrations/20260901000200_add_agent_thinking_mode/migration.sql`

### 后端

- `backend/src/modules/model-providers/dto/model-provider.dto.ts`
- `backend/src/modules/model-providers/dto/llm.dto.ts`
- `backend/src/modules/model-providers/model-providers.service.ts`
- `backend/src/modules/model-providers/gateway.ts`
- `backend/src/modules/model-providers/clients/openai-compatible.client.ts`
- `backend/src/modules/agents/dto/agent.dto.ts`
- `backend/src/modules/agents/agents.service.ts`
- `backend/src/modules/agent_runtime/agent-runtime.service.ts`

### 前端

- `frontend/src/features/model-providers/components/ModelConfigModal.tsx`
- `frontend/src/features/model-providers/components/ModelConfigList.tsx`
- `frontend/src/features/model-providers/api.ts`
- `frontend/src/features/agents/components/AgentFormModal.tsx`
- `frontend/src/features/agents/utils/agent-form.ts`
- `frontend/src/features/agents/api.ts`

## 16. 测试与验收

### 16.1 Provider Client 测试

已覆盖以下关键行为：

- `AUTO` 不发送 `enable_thinking`。
- `DISABLED` 发送 `enable_thinking: false`。
- 流式 `reasoning_content` 转换为独立 `reasoning_token`。
- 非流式响应将推理内容与正式回答分离。

建议继续补充：

- `ENABLED` 发送 `enable_thinking: true`。
- 模型不支持覆盖时忽略 Agent 的显式配置。
- Agent `AUTO` 正确继承模型三种默认模式。
- 切换模型时前端正确重置配置。

### 16.2 验收用例

#### 用例一：文案优化 Agent

```text
模型：thinkingSupported=true，默认 DISABLED
Agent：AUTO
预期：请求携带 enable_thinking=false，首 Token 明显缩短
```

#### 用例二：故障诊断 Agent

```text
模型：thinkingSupported=true，默认 DISABLED
Agent：ENABLED
预期：请求携带 enable_thinking=true，Trace 出现 reasoningObserved=true
```

#### 用例三：不支持思考覆盖的模型

```text
模型：thinkingSupported=false
Agent：任意历史值
预期：实际模式为 AUTO，请求体不包含 enable_thinking
```

#### 用例四：模型默认切换

```text
Agent：AUTO
模型默认：由 ENABLED 改为 DISABLED
预期：无需修改 Agent，下一次调用自动使用 DISABLED
```

## 17. 部署说明

生产部署直接运行：

```bash
./deploy.sh
```

调用链：

```text
deploy.sh
  -> deploy-backend.sh
  -> docker compose 启动 postgres
  -> migrate 容器执行 prisma migrate deploy
  -> 迁移成功后启动 API
```

部署后检查：

```bash
docker compose -p mia-backend --env-file .env.docker \
  -f docker-compose.backend.yml ps

docker compose -p mia-backend --env-file .env.docker \
  -f docker-compose.backend.yml logs migrate
```

## 18. 当前限制与后续演进

### 18.1 当前限制

1. `thinkingSupported` 是布尔能力，只表达“不支持/可选”，尚未表达“强制思考”。
2. 显式参数映射当前只针对兼容 `enable_thinking` 的 OpenAI-compatible 服务。
3. Agent 尚未提供按单次请求临时覆盖的用户界面。
4. 推理 Token 尚未纳入独立 Token 用量统计。
5. Workflow LLM 节点当前使用模型默认模式，没有节点级覆盖配置。

### 18.2 建议演进

后续统一模型能力体系时，可将布尔字段升级为：

```text
UNSUPPORTED
OPTIONAL
REQUIRED
```

并把供应商参数映射抽象为 Provider Client 能力：

```ts
type ReasoningCapability = {
  mode: "UNSUPPORTED" | "OPTIONAL" | "REQUIRED";
  defaultMode: "AUTO" | "ENABLED" | "DISABLED";
};
```

运行时优先级可扩展为：

```text
受控单次请求覆盖
  -> Agent 配置
    -> 模型默认
      -> Provider 默认
```

任何扩展都必须继续遵守：模型声明能力、Agent 决定业务偏好、Gateway 做最终安全收口、Provider Client 处理协议差异。
