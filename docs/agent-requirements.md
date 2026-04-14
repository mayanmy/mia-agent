# Agent 模块需求文档

## 1. 背景

Mia 是一个本地部署的内部 AI Agent 平台。Agent 是平台里的核心业务对象，代表一个可复用、可管理的 AI 助手配置。

Agent 不是模型本身，也不是对话执行器。它负责定义一个 AI 助手的身份、行为规则、模型选择和运行参数，后续由 Chat 模块基于 Agent 配置执行真实对话。

## 2. 产品定义

一句话：

> Agent 是团队创建的 AI 助手配置，它把模型、System Prompt、运行参数、知识库和工具能力组合成一个可复用的业务 AI 应用入口。

Mia v0.1 中，Agent 先聚焦于：

- 基础信息配置。
- System Prompt 配置。
- 绑定 Chat Model。
- 基础生成参数配置。
- 启用 / 停用。
- Agent CRUD 管理。

## 3. Agent 边界

### 3.1 Agent 负责什么

- 定义 AI 助手是谁。
- 定义助手服务什么业务场景。
- 定义助手的 System Prompt 和行为规则。
- 选择一个 Chat Model。
- 配置基础模型参数。
- 配置会话历史轮数。
- 作为用户后续发起 Chat 的入口。

### 3.2 Agent 不负责什么

- 不管理 Provider、Base URL、API Key。
- 不测试模型连通性。
- 不直接调用 LLM。
- 不上传、解析、切分文档。
- 不生成 embedding。
- 不执行向量检索。
- 不实现工具。
- 不存储 chat session / message。
- 不记录 LLM 调用日志。
- 不做 Workflow 编排。

## 4. v0.1 功能范围

### 4.1 必须做

- Agent 列表。
- Agent 创建。
- Agent 详情。
- Agent 更新。
- Agent 删除，采用软删除。
- Agent 启用 / 停用。
- Agent 绑定一个 Chat Model。
- Agent 配置 System Prompt。
- Agent 配置基础生成参数。

### 4.2 暂不做

- Agent 绑定知识库。
- Agent 绑定工具。
- Agent 权限控制。
- Agent 发布审批。
- Prompt 版本管理。
- Agent 使用统计。
- Agent 复制 / 导入 / 导出。
- Agent 头像上传。
- Agent 运行测试。

## 5. 用户操作流程

### 5.1 创建 Agent

1. 用户进入 Agent 管理页。
2. 点击创建 Agent。
3. 填写名称、描述、System Prompt。
4. 选择 Chat Model。
5. 配置 temperature、max tokens、timeout、history turns。
6. 点击保存。
7. 系统校验模型和参数。
8. 创建成功后返回 Agent 列表或展示成功提示。

### 5.2 查询 Agent

1. 用户进入 Agent 管理页。
2. 系统加载 Agent 列表。
3. 用户点击某个 Agent。
4. 系统展示 Agent 详情并填充编辑表单。

### 5.3 更新 Agent

1. 用户编辑 Agent 配置。
2. 点击保存。
3. 系统校验 Agent 是否存在。
4. 如果模型发生变化，校验新模型是否可用且类型为 Chat。
5. 保存成功后刷新列表或详情。

### 5.4 删除 Agent

1. 用户点击删除。
2. 系统确认 Agent 存在。
3. 系统软删除 Agent，并将其停用。
4. 列表中不再展示该 Agent。

## 6. 配置项

| 配置项 | 必填 | 说明 |
| --- | --- | --- |
| name | 是 | Agent 名称 |
| description | 否 | Agent 描述，空值返回空字符串 |
| systemPrompt | 是 | 系统 Prompt，定义 Agent 角色、任务和边界 |
| modelConfigId | 是 | 绑定的 Chat Model |
| temperature | 否 | 模型发散程度，默认 0.70 |
| maxTokens | 否 | 最大输出 token，可为空 |
| timeoutSeconds | 否 | 模型调用超时，默认 120 |
| historyTurns | 否 | 保留历史对话轮数，默认 6 |
| generationParams | 否 | 模型特有扩展参数，可为空 |
| enabled | 否 | 是否启用，默认 true |

## 7. 业务规则

- Agent 必须绑定一个启用的 Chat Model。
- Agent 不能绑定 Embedding Model。
- System Prompt 不能为空。
- 删除 Agent 必须软删除，不做物理删除。
- 删除 Agent 时同时设置 `enabled=false`。
- 当前没有 Auth/User 模块，因此暂不做同一创建者下名称唯一。
- 后续有 `created_by` 后，Agent 名称改为同一创建者下唯一。
- 当前不建 `agent_knowledge_bases` 和 `agent_tools`。
- Knowledge / Tools 表存在后，再建立真实多对多关联表。

## 8. 验收标准

### 8.1 后端验收

- Agent 列表接口可用。
- Agent 创建接口可用。
- Agent 详情接口可用。
- Agent 更新接口可用。
- Agent 删除接口可用。
- 创建 / 更新时会校验 `modelConfigId`。
- 创建 / 更新时会校验模型类型必须为 `CHAT`。
- 删除为软删除。
- 错误响应符合 `Result<null>`。

### 8.2 前端验收

- 可以查看 Agent 列表。
- 可以创建 Agent。
- 可以编辑 Agent。
- 可以删除 Agent。
- 表单可以选择 Chat Model。
- loading / error / success 状态明确。
- 刷新页面后数据仍存在。

### 8.3 通用验收

```bash
npm run prisma:generate
npm run typecheck
npm run build
```

数据库可用时：

```bash
npm run db:up
npm run prisma:deploy
npm run dev:api
npm run dev:web
```

