# Mia AgentVersion、发布与回滚技术方案

> 文档状态：P0 核心能力已于 2026-10-08 实施。本文同时保留后续版本 Diff、强制评测门禁和资源深度冻结的演进设计。

## 1. 文档目标

Mia 已具备 Agent 配置、统一 Agent Runtime、Run Trace、Workflow 不可变版本、RAG 评测、公开分享、Service API 和 Widget，但当前 Agent 的“发布”只更新 `published` 与 `published_at`。运行时仍直接读取可编辑的 Agent、工具、知识库和 Skill 绑定，因此草稿修改可能立即改变线上行为。

本文要解决以下问题：

1. 草稿编辑不能直接影响公开分享、Widget 和 Service API。
2. 每次正式运行必须能定位到唯一、不可变的 AgentVersion。
3. 发布前可以对候选版本调试和评测。
4. 发布、下线和回滚必须原子执行并保留完整审计记录。
5. 历史 Run 必须能够说明当时使用了哪套 Agent 配置。
6. Secret 轮换、资源停用和知识内容变化必须有明确边界，不能伪装成完全可重放。
7. 在兼容现有 Agent、公开链接和历史 Run 的前提下分阶段迁移。

### 1.1 当前实施范围

本次已落地不可变 AgentVersion、发布/回滚/下线审计、正式流量版本固定、Run 与 EvaluationRun 版本追踪、管理端版本发布入口，以及旧已发布 Agent 的回填脚本。

版本可视化 Diff、可配置评测门禁、Knowledge Index Revision、Tool Definition Revision 和更完整的自动重试策略仍按本文后续阶段推进，不属于本次 P0 交付。

## 2. 实施前基线与核心问题

### 2.1 当前发布语义

当前 `agents` 表同时保存以下内容：

- Agent 展示信息。
- System Prompt。
- 模型、视觉模型和生成参数。
- 会话策略和执行模式。
- `published`、`published_at` 与公开分享配置。

工具、知识库、Skill 和 Workflow 通过关联表绑定。`publishAgent()` 只把 `published` 更新为 `true`，不会复制或冻结运行配置。

当前运行链路为：

```text
Chat / Public Widget / Service API
  -> AgentRuntimeService
  -> AgentsService.getAgentRuntimeConfig(agentId)
  -> 实时读取 Agent 当前字段和当前绑定
```

### 2.2 主要风险

1. 编辑 Prompt、模型参数或绑定后，线上 Agent 行为立即漂移。
2. Skill 更新或停用后，历史发布内容无法准确复现。
3. HTTP/MCP Tool 定义更新后，旧版本实际执行的是新定义。
4. 评测 Run 虽保存部分配置快照，但不能保证评测对象与最终上线对象相同。
5. `AgentRun` 没有 `agentVersionId`，日志无法稳定关联发布制品。
6. 当前无法比较草稿与线上版本，也不能一键回滚到已验证版本。
7. Workflow 已使用不可变 `WorkflowVersion`，Agent 本身却仍是可变配置，整体发布语义不一致。

## 3. 范围

### 3.1 本方案实现

- Agent 可编辑草稿。
- 从草稿创建不可变 AgentVersion。
- 查看版本列表、版本详情和版本 Diff。
- 发布指定 AgentVersion。
- 下线当前公开版本。
- 回滚到任意仍有效的历史 AgentVersion。
- 工作台显式预览草稿或指定版本。
- Public、Widget 和 Service API 只执行当前已发布版本。
- AgentRun 和 EvaluationRun 固定 `agentVersionId`。
- 发布历史与操作者审计。
- 可选评测发布门禁。
- 旧数据回填和双读迁移。

### 3.2 本方案不实现

- 多环境 Dev/Staging/Production 发布流水线。
- 百分比灰度、用户分群和 A/B 流量分配。
- 跨 Workspace 复制或 Agent 市场。
- 自动回滚和自动恢复流量。
- 模型供应商输出的字节级确定性重放。
- 把知识库所有 Chunk 和 Embedding 复制进 AgentVersion。
- 把 API Key、OAuth Token 或工具 Secret 写入版本快照。

## 4. 设计原则

### 4.1 草稿、版本和发布是三个概念

```text
Agent Draft      可编辑的当前配置
AgentVersion     不可变的配置制品
AgentRelease     某个版本被上线、回滚或下线的审计事件
```

AgentVersion 不是“当前线上状态”，AgentRelease 也不是配置副本。当前线上版本由 `Agent.publishedVersionId` 指向。

### 4.2 正式入口只运行不可变版本

公开分享、Widget、Service API 和普通成员的正式 Chat 不允许直接读取草稿。只有明确的草稿测试入口可以使用 Draft Runtime。

### 4.3 回滚不覆盖草稿

回滚只把 `publishedVersionId` 切换到历史版本，并写入一条 `ROLLBACK` 发布记录。当前草稿保持不变，避免管理员尚未完成的编辑被隐式覆盖。

### 4.4 Secret 不进入版本

版本只保存 Secret 引用和非敏感配置。运行时通过所属模块读取当前有效 Secret。Secret 轮换不需要重新发布版本；Secret 缺失或被撤销时，运行明确失败并记录稳定错误类型。

### 4.5 版本固定不等于外部世界固定

AgentVersion 可以固定 Prompt、参数、绑定和工具定义，但不能保证：

- 外部模型服务返回完全一致。
- HTTP/MCP 服务返回完全一致。
- 当前阶段的知识库内容永远不变。
- Secret 永远有效。

Run Trace 必须记录实际资源指纹和运行结果，不得把 AgentVersion 描述成完整重放保证。

### 4.6 发布必须原子化

创建发布记录、切换线上指针和增加发布修订号必须在同一个数据库事务中完成。任何一步失败都不能暴露半发布状态。

## 5. 核心状态与流程

### 5.1 Agent 状态

Agent 不新增复杂状态枚举，使用以下字段组合表达：

| 状态   | `enabled` | `publishedVersionId` | 含义                                         |
| ------ | --------- | -------------------- | -------------------------------------------- |
| 草稿   | `true`    | `null`               | 可编辑、可测试，未正式发布                   |
| 已发布 | `true`    | 非空                 | 正式入口执行指定版本                         |
| 已下线 | `true`    | `null`               | 保留草稿、版本和分享配置，但正式入口拒绝运行 |
| 已停用 | `false`   | 任意                 | 所有入口拒绝运行，用于紧急止损               |
| 已删除 | 任意      | 任意                 | 软删除，不允许新运行                         |

兼容期保留 `published` 字段，但它不再作为权威来源：

```text
published = published_version_id IS NOT NULL
```

迁移完成后可删除 `published`，`publishedAt` 可保留为最近一次成功上线时间的冗余字段。

### 5.2 标准发布流程

```text
编辑 Draft
  -> draftRevision + 1
  -> 创建 AgentVersion 候选制品
  -> 对该 version 调试或运行评测
  -> 校验发布条件
  -> 事务内写 AgentRelease(PUBLISH)
  -> 切换 Agent.publishedVersionId
  -> 新请求开始使用新版本
```

### 5.3 回滚流程

```text
选择历史 AgentVersion
  -> 校验版本归属与可运行性
  -> 可选要求填写原因
  -> 事务内写 AgentRelease(ROLLBACK)
  -> publishedVersionId 指向历史版本
  -> 草稿不变化
```

回滚后如果需要继续基于旧版本修改，用户显式执行“从该版本恢复为草稿”。该操作会覆盖当前草稿，必须携带 `expectedDraftRevision` 并二次确认，不属于首期必须功能。

### 5.4 下线流程

```text
读取当前 publishedVersionId
  -> 写 AgentRelease(UNPUBLISH)
  -> publishedVersionId = null
  -> published = false（兼容期）
```

下线不删除版本、不删除 API Key、不轮换 `shareToken`。所有正式入口因为没有已发布版本而立即拒绝新运行。需要作废泄露凭据时，继续使用现有 Token/API Key 轮换或撤销能力。

## 6. 目标架构

```text
Agent Editor
  -> AgentsService                  草稿与版本制品
       -> Agent Draft
       -> AgentVersion

Publish / Rollback API
  -> AgentReleaseOrchestrator       发布门禁编排
       -> EvaluationsService        可选评测校验
       -> AgentsService             原子切换版本与写发布记录

Chat / Public / Service API
  -> AgentRuntimeService
       -> AgentsService.resolveRuntimeConfig(mode)
            -> DRAFT_PREVIEW
            -> VERSION
            -> PUBLISHED
       -> AgentRunsService          保存 agentVersionId 和 configHash
```

依赖方向：

```text
chat / external_access -> agent_runtime
agent_runtime -> agents
agent_runtime -> agent_runs
evaluations -> agents
agent_release_orchestration -> agents, evaluations
```

为避免 `agents <-> evaluations` 循环依赖，评测门禁编排不能直接塞入 `AgentsService`：

- `agents` 负责草稿、版本、发布事务和权限边界。
- `evaluations` 负责验证 EvaluationRun 是否满足门禁。
- 发布编排层先取得门禁结果，再调用 `AgentsService.activateVersion()`。
- 首期可以把编排 Service 放在独立 `agent_releases/` 模块；该模块只做高层用例编排，不直接查询任何业务表。

## 7. 数据库设计

### 7.1 枚举

```prisma
enum AgentReleaseAction {
  PUBLISH
  ROLLBACK
  UNPUBLISH
}
```

AgentVersion 不设置 `DRAFT/PUBLISHED/ARCHIVED` 状态。版本创建后即为不可变候选制品；是否被发布过由 `agent_releases` 判断，当前是否在线由 `agents.published_version_id` 判断。

### 7.2 agents 表调整

```prisma
model Agent {
  // existing fields
  draftRevision       Int           @default(1) @map("draft_revision")
  releaseRevision     Int           @default(0) @map("release_revision")
  publishedVersionId  String?       @map("published_version_id") @db.Uuid
  publishedVersion    AgentVersion? @relation(
    "AgentPublishedVersion",
    fields: [publishedVersionId],
    references: [id],
    onDelete: Restrict
  )
  versions             AgentVersion[] @relation("AgentVersions")
  releases             AgentRelease[]

  @@index([publishedVersionId], map: "idx_agents_published_version_id")
}
```

字段语义：

- `draftRevision`：任何影响 Agent 行为的草稿修改都必须递增。
- `releaseRevision`：每次发布、回滚或下线递增，用于发布并发控制。
- `publishedVersionId`：当前正式入口唯一权威版本指针。

以下更新都必须递增 `draftRevision`：

- Agent 基础运行字段。
- 工具绑定。
- Skill 绑定与顺序。
- 知识库绑定。
- Workflow 绑定与执行模式。
- 视觉模型策略。

名称、描述、公开访问 Origin、公开密码、分享 Token 等展示或访问控制字段不改变模型行为，不强制递增 `draftRevision`。实现时应把“运行配置更新”和“访问配置更新”拆成明确 Service 用例，避免误判。

### 7.3 agent_versions

```prisma
model AgentVersion {
  id                  String   @id @default(uuid()) @db.Uuid
  workspaceId         String   @map("workspace_id") @db.Uuid
  agentId             String   @map("agent_id") @db.Uuid
  version             Int
  schemaVersion       Int      @default(1) @map("schema_version")
  sourceDraftRevision Int      @map("source_draft_revision")
  configSnapshot      Json     @map("config_snapshot") @db.JsonB
  configHash          String   @map("config_hash")
  changeSummary       String   @default("") @map("change_summary") @db.Text
  createdByUserId     String   @map("created_by_user_id") @db.Uuid
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  agent               Agent    @relation("AgentVersions", fields: [agentId], references: [id], onDelete: Restrict)
  createdBy           User     @relation("AgentVersionCreator", fields: [createdByUserId], references: [id], onDelete: Restrict)
  publishedByAgents   Agent[]  @relation("AgentPublishedVersion")
  sourceReleases      AgentRelease[] @relation("AgentReleaseFromVersion")
  targetReleases      AgentRelease[] @relation("AgentReleaseTargetVersion")
  runs                AgentRun[]
  evaluationRuns      EvaluationRun[]

  @@unique([agentId, version], map: "uq_agent_versions_agent_version")
  @@index([agentId, createdAt(sort: Desc)], map: "idx_agent_versions_agent_created_at")
  @@index([workspaceId, configHash], map: "idx_agent_versions_workspace_hash")
  @@map("agent_versions")
}
```

约束：

1. AgentVersion 创建后禁止 Update 和 Delete。
2. `workspaceId` 必须与 Agent 一致，由 Service 从上下文写入，不能信任客户端。
3. `version` 在单个 Agent 内从 1 递增。
4. `configHash` 使用规范化 JSON 的 SHA-256。
5. 相同 `configHash` 不设唯一约束；Service 默认复用最近的相同版本，管理员显式要求时也不应无意义重复创建。
6. 软删除 Agent 后保留版本、发布记录和 Run 引用。

### 7.4 agent_releases

```prisma
model AgentRelease {
  id                    String             @id @default(uuid()) @db.Uuid
  workspaceId           String             @map("workspace_id") @db.Uuid
  agentId               String             @map("agent_id") @db.Uuid
  sequence              Int
  action                AgentReleaseAction
  fromVersionId         String?            @map("from_version_id") @db.Uuid
  targetVersionId       String?            @map("target_version_id") @db.Uuid
  evaluationRunId       String?            @map("evaluation_run_id") @db.Uuid
  reason                String             @default("") @db.Text
  expectedDraftRevision Int?               @map("expected_draft_revision")
  createdByUserId       String             @map("created_by_user_id") @db.Uuid
  createdAt             DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)
  agent                 Agent              @relation(fields: [agentId], references: [id], onDelete: Restrict)
  fromVersion           AgentVersion?      @relation("AgentReleaseFromVersion", fields: [fromVersionId], references: [id], onDelete: Restrict)
  targetVersion         AgentVersion?      @relation("AgentReleaseTargetVersion", fields: [targetVersionId], references: [id], onDelete: Restrict)
  createdBy             User               @relation("AgentReleaseCreator", fields: [createdByUserId], references: [id], onDelete: Restrict)

  @@unique([agentId, sequence], map: "uq_agent_releases_agent_sequence")
  @@index([agentId, createdAt(sort: Desc)], map: "idx_agent_releases_agent_created_at")
  @@index([targetVersionId, createdAt(sort: Desc)], map: "idx_agent_releases_target_created_at")
  @@map("agent_releases")
}
```

`evaluationRunId` 作为跨模块业务关联 ID 保存。`agents` 模块不得直接查询评测表；发布编排层必须先通过 `EvaluationsService` 验证，再把已验证 ID 传给发布事务。

发布记录规则：

| Action   | fromVersionId | targetVersionId |
| -------- | ------------- | --------------- |
| 首次发布 | `null`        | 新版本          |
| 升级发布 | 当前版本      | 新版本          |
| 回滚     | 当前版本      | 历史版本        |
| 下线     | 当前版本      | `null`          |

### 7.5 agent_runs 调整

```prisma
model AgentRun {
  // existing fields
  agentVersionId String?       @map("agent_version_id") @db.Uuid
  configHash     String?       @map("config_hash")
  runtimeMode    String?       @map("runtime_mode")
  agentVersion   AgentVersion? @relation(fields: [agentVersionId], references: [id], onDelete: Restrict)

  @@index([agentVersionId, createdAt(sort: Desc)], map: "idx_agent_runs_version_created_at")
}
```

`runtimeMode` 首期取值：

```text
DRAFT_PREVIEW
VERSION_TEST
PUBLISHED
LEGACY
```

- 正式运行必须有 `agentVersionId` 和 `configHash`。
- 草稿预览没有持久 AgentVersion 时，`agentVersionId=null`，但必须保存草稿 revision 和 config hash 到 Run Step 或执行快照。
- 历史 Run 迁移为 `LEGACY`，不能伪造版本关联。

### 7.6 evaluation_runs 调整

```prisma
model EvaluationRun {
  // existing fields
  agentVersionId String?       @map("agent_version_id") @db.Uuid
  agentVersion   AgentVersion? @relation(fields: [agentVersionId], references: [id], onDelete: Restrict)

  @@index([agentVersionId, createdAt(sort: Desc)], map: "idx_evaluation_runs_agent_version_created")
}
```

新评测必须指定 `agentVersionId`。兼容期允许历史记录为空；迁移完成后新建路径在 Service 层强制非空，不急于把数据库列改为 `NOT NULL`，以保留历史数据。

## 8. AgentVersion 快照结构

### 8.1 顶层 DTO

```typescript
type AgentVersionSnapshotV1 = {
  schemaVersion: 1;
  agent: {
    id: string;
    nameSnapshot: string;
    systemPrompt: string;
    executionMode: "AGENT_LOOP" | "WORKFLOW";
    chatSessionMode: "EPHEMERAL" | "PERSISTENT";
    historyTurns: number;
    temperature: number;
    maxTokens: number | null;
    timeoutSeconds: number;
    thinkingMode: "AUTO" | "ENABLED" | "DISABLED";
    generationParams: Record<string, JsonValue> | null;
    promptTemplateVersion: string;
  };
  model: VersionedModelRuntimeRef;
  vision: VersionedVisionRuntimeRef;
  retrieval: VersionedRetrievalConfig;
  tools: VersionedToolBinding[];
  skills: VersionedSkillBinding[];
  workflow: VersionedWorkflowBinding | null;
  runtimePolicy: {
    maxToolRounds: number;
    maxToolCalls: number;
    contextBudgetVersion: string;
  };
};
```

快照必须保存“展开后的运行配置”，不能只保存当前关联表 ID，否则关联内容变化后仍会漂移。

### 8.2 模型快照

```typescript
type VersionedModelRuntimeRef = {
  modelConfigId: string;
  providerId: string;
  providerType: string;
  modelName: string;
  baseUrl: string;
  contextLength: number;
  timeoutSeconds: number;
  maxTokens: number | null;
  thinkingSupported: boolean;
  capabilities: Array<{ capability: string; options: JsonValue | null }>;
  configFingerprint: string;
};
```

不包含 Provider API Key。模型调用时由 `ModelProvidersService` 使用 `providerId` 解析当前密钥，但请求协议、模型名、Base URL 和能力声明以版本快照为准。

如果当前 Provider 已停用、删除或凭据缺失，返回明确的 `VERSION_RESOURCE_UNAVAILABLE`，不得静默切换到其他模型。自动 fallback 必须由版本快照中的显式策略控制。

### 8.3 Skill 快照

Skill 必须保存完整可执行内容：

```typescript
type VersionedSkillBinding = {
  skillId: string;
  revision: number;
  position: number;
  name: string;
  instructions: string;
  usageConditions: string;
  inputGuidance: string;
  outputGuidance: string;
  limitations: string;
  contentHash: string;
};
```

发布版本不再读取 Skill 当前 revision。后续编辑、停用或归档 Skill 不改变已发布版本。紧急安全止损应停用 Agent、下线版本或使用平台级内容阻断，不通过修改历史快照实现。

### 8.4 Tool/MCP 快照

Tool 快照保存模型可见定义与执行所需的非敏感配置：

```typescript
type VersionedToolBinding = {
  runtimeToolId: string;
  source: "BUILTIN" | "HTTP" | "MCP";
  name: string;
  description: string;
  inputSchema: JsonValue;
  executionConfig: JsonValue;
  secretRefIds: string[];
  definitionHash: string;
};
```

要求：

- HTTP URL、Method、参数规则、超时和响应限制进入快照。
- MCP Server、远程 Tool 名称、输入 Schema、风险等级和审批模式进入快照。
- Authorization、API Key、OAuth Token 和动态访问令牌不得进入快照。
- `ToolsService` 新增按版本快照执行的公开方法，Runtime 不直接解析 HTTP/MCP 内部结构。
- 当前全局安全策略仍具有最高优先级，例如 SSRF 防护、出站域名限制、审批和紧急禁用。

### 8.5 知识库与检索快照

首期保存：

```typescript
type VersionedRetrievalConfig = {
  knowledgeBases: Array<{
    knowledgeBaseId: string;
    embeddingModelConfigId: string;
    indexFingerprint: string | null;
  }>;
  topK: number;
  scoreThreshold: number | null;
  hybridSearch: JsonValue | null;
  rerank: JsonValue | null;
};
```

边界：

- AgentVersion 固定绑定集合和检索参数。
- 当前知识库没有不可变 Index Revision，因此首期运行仍读取知识库最新已索引内容。
- 每次 Run 必须记录实际 `indexFingerprint`；与发布时不一致时在 Trace 标记 `KNOWLEDGE_INDEX_DRIFT`。
- 精确知识重放需要后续引入 `KnowledgeIndexRevision`，由 `retrieval` 通过明确 revision 查询，不能把全部 Chunk 复制到 AgentVersion JSON。

### 8.6 Workflow 快照

```typescript
type VersionedWorkflowBinding = {
  workflowId: string;
  workflowVersionId: string;
  checksum: string;
};
```

Workflow 已有不可变版本。AgentVersion 只保存并校验明确的 `workflowVersionId` 和 checksum，不复制完整 Graph/Compiled Plan。

### 8.7 规范化与 Hash

创建版本时执行：

```text
跨模块解析 Draft Runtime
-> 删除 Secret 与不稳定展示字段
-> 对对象 Key 递归排序
-> 保留数组业务顺序
-> canonical JSON
-> sha256(schemaVersion + canonicalJson)
```

禁止直接对普通 `JSON.stringify()` 结果计算 Hash，因为对象键顺序和未定义字段可能造成相同配置得到不同 Hash。

## 9. Service 与模块边界

### 9.1 AgentsService

新增公开用例：

```typescript
createAgentVersion(
  agentId: string,
  actorId: string,
  payload: CreateAgentVersionDto
): Promise<AgentVersionDetail>;

listAgentVersions(agentId: string, query: PageQuery): Promise<PageResult<AgentVersionListItem>>;

getAgentVersion(agentId: string, versionId: string): Promise<AgentVersionDetail>;

compareAgentVersions(
  agentId: string,
  baseVersionId: string,
  targetVersionId: string
): Promise<AgentVersionDiff>;

getVersionRuntimeConfig(
  agentId: string,
  versionId: string
): Promise<AgentRuntimeConfig>;

getPublishedRuntimeConfig(agentId: string): Promise<AgentRuntimeConfig>;

activateVersion(
  agentId: string,
  actorId: string,
  payload: ActivateAgentVersionDto
): Promise<AgentReleaseResult>;

unpublishAgent(
  agentId: string,
  actorId: string,
  payload: UnpublishAgentDto
): Promise<AgentReleaseResult>;
```

`activateVersion()` 只接受已经由上层完成门禁校验的稳定 DTO，不接收 Nest Request，也不调用 EvaluationsService。

### 9.2 跨模块版本快照接口

`AgentsService.createAgentVersion()` 不得直接查询其他模块的内部表。各模块提供面向版本化的 DTO：

```typescript
ModelProvidersService.getVersionedModelRuntimeRef(modelConfigId);
SkillsService.getVersionedSkillSnapshots(bindings);
ToolsService.getVersionedToolSnapshots(toolIds);
KnowledgeService.getVersionedKnowledgeRefs(knowledgeBaseIds);
WorkflowsService.getPublishedVersionRef(workflowId, workflowVersionId);
```

这些方法只返回可 JSON 序列化、已脱敏 DTO。

### 9.3 Runtime 解析模式

替换语义含糊的 `getAgentRuntimeConfig(id)`：

```typescript
type AgentRuntimeSelection =
  | { mode: "PUBLISHED" }
  | { mode: "VERSION"; versionId: string }
  | { mode: "DRAFT_PREVIEW"; expectedDraftRevision?: number };

resolveAgentRuntimeConfig(
  agentId: string,
  selection: AgentRuntimeSelection,
  actor?: RuntimeActor
): Promise<AgentRuntimeConfig>;
```

权限规则：

| 模式            | 使用场景                               | 权限                       |
| --------------- | -------------------------------------- | -------------------------- |
| `PUBLISHED`     | 正式 Chat、Public、Widget、Service API | Agent 可用且存在线上版本   |
| `VERSION`       | 版本调试、评测、管理员排障             | 可管理 Agent 或评测 Worker |
| `DRAFT_PREVIEW` | 编辑器测试草稿                         | 创建者、OWNER 或 MANAGER   |

运行 DTO 增加：

```typescript
type AgentRuntimeConfig = {
  agentId: string;
  agentVersionId: string | null;
  configHash: string;
  runtimeMode: "PUBLISHED" | "VERSION_TEST" | "DRAFT_PREVIEW" | "LEGACY";
  sourceDraftRevision?: number;
  // existing runtime fields
};
```

### 9.4 AgentRunsService

`CreateAgentRunDto` 增加：

```typescript
type CreateAgentRunDto = {
  // existing fields
  agentVersionId?: string;
  configHash?: string;
  runtimeMode?: AgentRuntimeMode;
};
```

Runtime 必须先解析版本配置，再创建 Run：

```text
resolve runtime version
-> create AgentRun(agentVersionId, configHash, runtimeMode)
-> start execution
```

不能先创建无版本 Run，再异步回填版本，否则进程崩溃会留下无法解释的正式运行记录。

## 10. 发布事务与并发控制

### 10.1 创建版本

请求必须携带 `expectedDraftRevision`：

```typescript
type CreateAgentVersionDto = {
  expectedDraftRevision: number;
  changeSummary?: string;
};
```

流程：

```text
校验管理权限
-> 读取 Draft 及全部绑定
-> draftRevision 必须等于 expectedDraftRevision
-> 跨模块解析并校验资源
-> 生成规范化快照和 configHash
-> Serializable transaction:
     再次校验 draftRevision
     计算下一个 version
     创建 AgentVersion
-> 返回不可变版本
```

出现序列化冲突或唯一键冲突时，服务端最多自动重试 2 次；草稿 revision 已变化时返回 `AGENT_DRAFT_CONFLICT`，要求客户端重新加载。

### 10.2 发布或回滚

```typescript
type ActivateAgentVersionDto = {
  versionId: string;
  action: "PUBLISH" | "ROLLBACK";
  expectedReleaseRevision: number;
  evaluationRunId?: string;
  reason?: string;
};
```

事务：

```text
Serializable transaction:
  1. 读取 Agent 当前 publishedVersionId / releaseRevision
  2. 校验 expectedReleaseRevision
  3. 校验 target version 属于同一 Agent 和 Workspace
  4. 校验 target version schema 可执行
  5. action 与当前版本关系一致
  6. 创建 AgentRelease(sequence = releaseRevision + 1)
  7. 更新 Agent:
       publishedVersionId = target
       published = true              // 兼容期
       publishedAt = now()
       releaseRevision += 1
  8. commit
```

如果目标版本已是当前版本，返回幂等成功，不重复写 Release；若请求携带不同 `reason` 也不创建无状态变化的假发布记录。

### 10.3 下线

下线同样使用 `expectedReleaseRevision`。如果已经下线则幂等返回，不重复增加 revision。

### 10.4 缓存一致性

首期规则：

- `publishedVersionId` 每次正式运行从数据库读取，不缓存，保证发布后新请求立即一致。
- 不可变 AgentVersion 可以按 `versionId + configHash` 长期缓存。
- 发布事务提交后再删除 Agent 列表和公开元数据缓存。
- 缓存删除失败不能回滚数据库发布；新架构如引入多实例，使用 Redis Pub/Sub 或 Outbox 广播失效事件。
- 已经开始的 Run 继续使用启动时解析出的版本，不在流式响应中途切换。

## 11. 评测门禁

### 11.1 评测对象

新建 EvaluationRun 时必须传 `agentVersionId`，评测 Worker 调用：

```typescript
AgentsService.getVersionRuntimeConfig(agentId, agentVersionId);
```

不再在评测开始时读取可变 Draft。现有 `agentConfigSnapshot` 等字段暂时保留，用于保存评测运行快照和兼容报告，但 `agentVersionId + configHash` 是配置身份的权威来源。

### 11.2 门禁策略

首期允许 Agent 不启用门禁。启用时建议配置：

```typescript
type AgentReleasePolicy = {
  enabled: boolean;
  datasetVersionId: string;
  maxEvaluationAgeHours: number;
  thresholds: {
    minCaseSuccessRate?: number;
    minRecallAt5?: number;
    minAnswerCorrectness?: number;
    minFaithfulness?: number;
    maxErrorRate?: number;
    maxP95LatencyMs?: number;
    maxAverageCost?: number;
  };
};
```

门禁验证必须确认：

1. EvaluationRun 状态为 `COMPLETED`。
2. `agentId` 和 `agentVersionId` 与发布目标一致。
3. 数据集版本符合策略。
4. `snapshotHash/configHash` 未漂移。
5. 指标版本兼容。
6. 评测完成时间未超过最大有效期。
7. 所有启用阈值通过。

不允许客户端只传 `passed=true`。发布编排层必须从 EvaluationsService 获取服务端验证结果。

### 11.3 紧急回滚

回滚默认不要求重新评测，但必须满足：

- 目标版本历史上至少成功发布过；或操作者为 OWNER 并显式选择紧急回滚。
- 填写回滚原因。
- 记录是否绕过当前评测策略。

回滚是恢复已知稳定版本的止损操作，不应被评测系统不可用阻塞。

## 12. API 设计

### 12.1 版本 API

```text
POST /api/v1/agents/:agentId/versions
GET  /api/v1/agents/:agentId/versions
GET  /api/v1/agents/:agentId/versions/:versionId
GET  /api/v1/agents/:agentId/versions/compare?baseVersionId=...&targetVersionId=...
POST /api/v1/agents/:agentId/versions/:versionId/test
```

创建版本请求：

```json
{
  "expectedDraftRevision": 12,
  "changeSummary": "调整客服拒答规则并更新订单查询工具"
}
```

版本列表项：

```typescript
type AgentVersionListItem = {
  id: string;
  version: number;
  configHash: string;
  sourceDraftRevision: number;
  changeSummary: string;
  isPublished: boolean;
  releaseCount: number;
  lastReleasedAt: Date | null;
  createdBy: { id: string; displayName: string };
  createdAt: Date;
};
```

### 12.2 发布与回滚 API

```text
POST   /api/v1/agents/:agentId/releases
GET    /api/v1/agents/:agentId/releases
DELETE /api/v1/agents/:agentId/publish
```

发布：

```json
{
  "versionId": "...",
  "action": "PUBLISH",
  "expectedReleaseRevision": 3,
  "evaluationRunId": "...",
  "reason": "RAG v2 评测通过，发布客服规则优化"
}
```

回滚：

```json
{
  "versionId": "...",
  "action": "ROLLBACK",
  "expectedReleaseRevision": 4,
  "reason": "新版本工具调用失败率升高，回滚到 v3"
}
```

`action=ROLLBACK` 时目标版本必须不是当前版本。普通发布可以选择从未发布过的候选版本。

### 12.3 兼容 API

现有：

```text
POST /api/v1/agents/:id/publish
```

兼容期行为改为：

```text
基于当前 Draft 创建 AgentVersion
-> 无强制门禁时立即发布
-> 返回 versionId、version、releaseRevision 和原分享字段
```

当 Agent 启用强制评测门禁时，旧接口返回 `AGENT_RELEASE_EVALUATION_REQUIRED`，前端引导使用候选版本发布流程。新前端稳定后废弃旧接口。

## 13. Version Diff

Diff 由后端对结构化快照生成，不在前端直接比较大 JSON。

```typescript
type AgentVersionDiff = {
  baseVersion: number;
  targetVersion: number;
  changedSections: Array<
    | "PROMPT"
    | "MODEL"
    | "GENERATION"
    | "CONTEXT"
    | "KNOWLEDGE"
    | "TOOLS"
    | "SKILLS"
    | "WORKFLOW"
    | "RUNTIME_POLICY"
  >;
  fields: Array<{
    path: string;
    change: "ADDED" | "REMOVED" | "CHANGED" | "REORDERED";
    before: JsonValue;
    after: JsonValue;
    sensitive: boolean;
  }>;
};
```

约束：

- Prompt 可返回文本 Diff，但限制总长度。
- Tool/MCP Secret 永远不会出现在快照或 Diff。
- Skill 顺序变化单独标记 `REORDERED`。
- 大对象只返回摘要和 Hash，避免版本详情接口无限膨胀。

## 14. 前端设计

### 14.1 Agent 编辑页

页头展示：

```text
草稿 revision 12
线上版本 v4
存在未发布变更
[测试草稿] [创建版本] [发布]
```

“存在未发布变更”通过草稿规范化 Hash 与线上版本 `configHash` 比较，不只比较 `updatedAt`。

### 14.2 版本抽屉

提供：

- 版本号、说明、创建者和创建时间。
- 是否当前线上版本。
- 版本摘要和资源指纹。
- 与当前草稿比较。
- 与任意历史版本比较。
- 测试版本、运行评测、发布和回滚入口。

### 14.3 发布弹窗

展示：

- 目标版本和当前线上版本。
- 主要 Diff。
- 评测状态与门禁结果。
- 资源预检结果。
- 发布说明。

发布按钮提交时携带页面加载到的 `releaseRevision`。冲突时提示“线上版本已被其他成员修改”，重新加载后再确认。

### 14.4 回滚弹窗

必须清晰提示：

- 回滚只切换线上版本，不会覆盖当前草稿。
- 已开始的会话请求不会中途切换。
- 新请求会立即使用目标版本。
- 是否绕过了当前评测策略。

## 15. 错误模型

建议新增稳定错误码：

| 错误码                              | HTTP    | 含义                                   |
| ----------------------------------- | ------- | -------------------------------------- |
| `AGENT_DRAFT_CONFLICT`              | 409     | 草稿 revision 已变化                   |
| `AGENT_RELEASE_CONFLICT`            | 409     | 发布 revision 已变化                   |
| `AGENT_VERSION_NOT_FOUND`           | 404     | 版本不存在或不属于当前 Workspace/Agent |
| `AGENT_VERSION_INVALID`             | 409     | 版本 Schema 不支持或配置损坏           |
| `AGENT_NOT_PUBLISHED`               | 409/404 | 正式入口没有可执行版本                 |
| `AGENT_RELEASE_EVALUATION_REQUIRED` | 409     | 发布策略要求评测                       |
| `AGENT_RELEASE_EVALUATION_FAILED`   | 409     | 评测未完成、过期或未通过               |
| `VERSION_RESOURCE_UNAVAILABLE`      | 409/503 | 版本引用的模型、Secret 或资源不可用    |
| `VERSION_CONFIG_HASH_MISMATCH`      | 500     | 快照完整性校验失败                     |

匿名公开入口继续返回安全、模糊化消息，不暴露资源 ID、Provider 配置或内部版本细节。

## 16. 安全与权限

- 创建版本：Agent 创建者、Workspace OWNER/MANAGER。
- 查看版本：具有 Agent 管理权限的成员；普通使用者只看到当前版本号摘要。
- 发布、回滚、下线：首期沿用 Agent 管理权限；启用强制门禁后建议限制为 OWNER/MANAGER。
- 版本详情 API 必须在 Service 中同时校验 `workspaceId + agentId + versionId`。
- 跨 Workspace 资源统一返回 404，避免枚举。
- 版本快照和发布记录不可由普通更新 API 修改。
- 所有发布操作写入结构化审计字段，不依赖普通应用日志作为唯一证据。
- Version Diff 默认脱敏，任何 Secret、Authorization 和附件 Data URL 均不得进入快照。

## 17. 数据迁移与兼容方案

### 17.1 阶段一：加表与可空字段

新增：

- `agent_versions`
- `agent_releases`
- `agents.draft_revision`
- `agents.release_revision`
- `agents.published_version_id`
- `agent_runs.agent_version_id/config_hash/runtime_mode`
- `evaluation_runs.agent_version_id`

所有历史关联字段先允许为空，不立即改变线上读取路径。

### 17.2 阶段二：回填已发布 Agent

对每个 `published=true AND deleted_at IS NULL` 的 Agent：

```text
读取当前运行配置
-> 构建 AgentVersionSnapshotV1
-> 创建 version=1
-> 创建 AgentRelease(sequence=1, action=PUBLISH)
-> 设置 publishedVersionId
-> releaseRevision=1
```

回填脚本要求：

- 按 Agent 独立事务执行。
- 可重复运行并保持幂等。
- 资源缺失时不制造不完整版本，记录失败清单并保留旧读取路径。
- 不输出 Secret 或完整 Prompt 到终端日志。
- 完成后输出成功、跳过、失败数量与 Agent ID。

未发布 Agent 不创建空版本，保留为 Draft。

### 17.3 阶段三：双读

```text
有 publishedVersionId -> 读取 AgentVersion
无 publishedVersionId 且 published=true -> LEGACY 当前配置
其他 -> 未发布
```

所有新 AgentVersion 运行开始写 `agentVersionId`。监控 LEGACY 运行数量，降到零后再进入下一阶段。

### 17.4 阶段四：正式入口切换

- Public、Widget、Service API 强制使用 `PUBLISHED`。
- 普通 Chat 默认使用 `PUBLISHED`。
- 草稿测试必须显式选择 `DRAFT_PREVIEW`。
- EvaluationRun 强制指定 AgentVersion。

### 17.5 阶段五：收紧约束

- 删除 LEGACY 读取分支。
- 停止写旧 `published` 权威状态，只保留兼容冗余或删除字段。
- 新正式 Run 在 Service 层强制 `agentVersionId` 非空。
- 增加数据巡检：线上指针、版本归属、Hash 和发布记录必须一致。

## 18. 可观测性与审计

新增指标：

```text
mia_agent_version_created_total
mia_agent_release_total{action}
mia_agent_release_conflict_total
mia_agent_release_gate_failed_total{reason}
mia_agent_runtime_total{runtime_mode,version}
mia_agent_legacy_runtime_total
mia_agent_version_resource_unavailable_total{resource_type}
mia_agent_knowledge_index_drift_total
```

日志上下文增加：

```text
agent_id
agent_version_id
agent_version_number
config_hash
release_sequence
runtime_mode
evaluation_run_id
```

发布审计页面至少可回答：

- 谁在什么时间把哪个版本切换成了哪个版本。
- 是普通发布、回滚还是下线。
- 发布说明和回滚原因。
- 使用了哪个评测 Run，是否通过门禁或被紧急绕过。
- 发布后的 Run 成功率、错误率和成本变化。

## 19. 测试方案

### 19.1 单元测试

必须覆盖：

1. 规范化 JSON 对键顺序稳定、对数组顺序敏感。
2. Secret 不进入 Version Snapshot。
3. Skill 内容和顺序正确冻结。
4. Tool Snapshot 使用版本定义，不读取后续修改后的定义。
5. `expectedDraftRevision` 冲突阻止创建版本。
6. `expectedReleaseRevision` 冲突阻止覆盖他人发布。
7. 重复发布当前版本幂等。
8. 回滚不修改 Draft 和 `draftRevision`。
9. 下线保留历史版本和分享 Token。
10. 版本 Hash 损坏时阻断运行。
11. 跨 Workspace 版本统一返回 404。
12. 评测门禁拒绝错误版本、过期结果和不兼容指标。

### 19.2 Service 集成测试

覆盖完整流程：

```text
创建 Agent
-> 修改 Draft
-> 创建 v1
-> 发布 v1
-> 修改 Draft
-> 正式运行仍使用 v1
-> 创建并评测 v2
-> 发布 v2
-> 新 Run 使用 v2
-> 回滚 v1
-> 新 Run 使用 v1
-> Draft 仍保持 v2 后的编辑内容
```

同时验证：

- Public、Widget、Service API 使用同一 publishedVersionId。
- 已开始的 v1 SSE 在发布 v2 后继续完成 v1。
- Run、ToolCallLog、RagTrace 能通过 runId 定位版本。
- EvaluationRun 与发布目标版本一致。

### 19.3 迁移测试

- 已发布历史 Agent 能生成 v1 并保持外部访问行为。
- 未发布 Agent 不会被意外发布。
- 回填中断后可安全重跑。
- 缺失模型、工具或 Skill 时进入失败清单，不生成残缺版本。
- 历史 Run 保持可查看且标记为 LEGACY。

### 19.4 前端验收

- 草稿修改后明确显示“存在未发布变更”。
- 发布前可以查看 Diff 和评测结果。
- 并发发布冲突不会静默覆盖。
- 回滚提示明确说明草稿不会变化。
- 版本、发布记录和 Run 链路可以相互跳转。

## 20. 分阶段实施计划

### P0-1：版本基础

- Prisma 模型与迁移。
- Draft revision。
- Snapshot Builder、规范化 Hash。
- 创建、列表、详情和 Diff API。
- AgentRun 增加版本字段。

验收：可以从 Draft 创建不可变版本，并用指定版本运行测试。

### P0-2：正式发布与回滚

- `publishedVersionId` 权威指针。
- AgentRelease 审计记录。
- 发布、下线、回滚事务和并发控制。
- Public、Widget、Service API 切换到发布版本。
- 前端版本和发布 UI。

验收：修改 Draft 不影响线上 Agent；新请求可发布、回滚和下线。

### P0-3：评测绑定

- EvaluationRun 固定 AgentVersion。
- 评测报告显示版本号和 Hash。
- 可选发布门禁。
- 发布页展示评测结果。

验收：评测对象与发布对象一致，不允许用 A 版本评测结果发布 B 版本。

### P1：知识版本与高级发布

- KnowledgeIndexRevision。
- 发布资源预检和漂移报告。
- 发布前后质量/成本对比。
- 紧急回滚策略。
- 多实例缓存失效事件。

后续再评估灰度发布和 A/B 流量，不在本方案 P0 内提前建设。

## 21. 验收标准

本方案完成必须同时满足：

1. 草稿修改不会影响已发布 Agent 的正式运行。
2. Public、Widget、Service API 和正式 Chat 使用同一个已发布版本。
3. 每个新正式 AgentRun 都包含 `agentVersionId` 和 `configHash`。
4. AgentVersion 创建后不可更新或删除。
5. 发布、回滚和下线具有原子事务、乐观并发控制和审计记录。
6. 回滚不覆盖草稿，且新请求立即使用目标历史版本。
7. 评测 Run 能固定 AgentVersion，门禁不能跨版本复用结果。
8. Secret 不进入版本快照、Diff、Run Trace 或普通日志。
9. 历史 Agent 和 Run 完成兼容迁移，LEGACY 路径最终归零。
10. 管理员可以从一次异常 Run 追溯到版本、发布记录、评测结果和配置 Diff。

## 22. 关键决策总结

| 决策                         | 结论                                                      |
| ---------------------------- | --------------------------------------------------------- |
| Agent 表是否继续保存草稿字段 | 是，降低现有编辑接口迁移成本                              |
| AgentVersion 是否可修改      | 不可修改、不可删除                                        |
| 发布是否自动复制新版本       | 新流程先创建候选版本，再发布；旧接口仅作兼容包装          |
| 回滚是否创建重复版本         | 否，只切换指针并记录 Release                              |
| 回滚是否覆盖草稿             | 否                                                        |
| Secret 是否快照              | 否，只保存引用并读取当前有效 Secret                       |
| Skill 内容是否快照           | 是，保存明确 revision 和完整指令内容                      |
| Tool 定义是否快照            | 是，保存非敏感执行定义和 Schema                           |
| Workflow 是否复制完整图      | 否，固定已有不可变 WorkflowVersion                        |
| Knowledge 内容是否完全冻结   | P0 不冻结，记录 index fingerprint；P1 引入 Index Revision |
| 已开始的 Run 是否随发布切换  | 否，Run 启动时固定版本直到终态                            |
| 评测是否针对 Draft           | 否，新评测针对不可变候选 AgentVersion                     |

AgentVersion 的核心价值不是增加一个“历史记录”页面，而是建立一条可信边界：编辑发生在 Draft，验证发生在不可变 Version，线上流量只运行明确发布的 Version，Run 与评测都能追溯到同一个配置制品。
