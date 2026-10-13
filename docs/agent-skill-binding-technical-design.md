# AgentSkill 绑定与 Runtime 注入技术方案

## 1. 文档信息

- 文档状态：待实施
- 方案版本：V1.0
- 编写日期：2026-09-01
- 适用范围：Mia `agents`、`skills`、`agent_runtime`、Prompt Builder 与 Agent 管理前端

## 2. 背景

Mia 已具备 Skill 的创建、编辑、启停、归档和 MCP Prompt 草稿导入能力，但 Skill 当前只是可管理的指令资产：Agent 没有 Skill 绑定关系，`AgentRuntimeConfig` 不包含 Skill，Prompt Builder 也不会把 Skill 指令写入模型上下文。

本方案建立以下最小闭环：

```text
Skill 管理
  -> Agent 按顺序绑定 Skill
  -> AgentsService 生成稳定 Runtime DTO
  -> AgentRuntime 记录本次生效 Skill 快照
  -> Prompt Builder 按稳定顺序注入 Skill
  -> 模型执行
```

## 3. 目标与非目标

### 3.1 目标

1. 一个 Agent 可以绑定多个 Skill，一个 Skill 可以被多个 Agent 复用。
2. 管理员可以在 Agent 编辑页选择 Skill 并调整注入顺序。
3. 绑定写入、读取和 Runtime 注入顺序稳定、可测试、可审计。
4. Agent Runtime 只使用跨模块 DTO，不读取 Skill 表或 Prisma Model。
5. 停用、归档或跨 Workspace 的 Skill 不进入模型 Prompt。
6. Skill Prompt 设置数量和字符预算，防止上下文被无限占用。
7. Run Trace 记录实际生效和被跳过的 Skill ID、revision 与原因。

### 3.2 P0 非目标

- 不实现 Skill 自动检索、Embedding 匹配或额外 LLM 分类。
- 不实现 Skill 依赖的工具、知识库自动绑定。
- 不实现 Skill 参数模板或用户自定义变量。
- 不实现 AgentVersion 中的 Skill 不可变快照；P0 使用运行时最新启用 revision。
- 不允许 Skill 修改平台安全规则、模型路由或权限边界。
- 不将 Skill 实现成可执行代码、工具或 Workflow。

## 4. 模块边界与依赖方向

### 4.1 数据归属

- `skills`：拥有 Skill 内容、状态、revision 和来源信息。
- `agents`：拥有 Agent 与 Skill 的绑定、顺序和启用偏好。
- `agent_runtime`：使用 `AgentRuntimeConfig.skills`，不查询 `skills` 或 `agent_skills` 表。
- Prompt Builder：只负责纯文本渲染，不访问数据库或 Service。

新增允许依赖：

```text
agents -> skills
agent_runtime -> agents
```

`AgentsService` 不得直接读取 `skills` 表。它先读取本模块的 `agent_skills`，再调用 `SkillsService.getRuntimeSkills()` 获取可序列化 DTO。

### 4.2 为什么不由 Runtime 直接调用 SkillsService

`AgentRuntimeConfig` 是 Agent 执行配置的唯一稳定入口。若 Runtime 分别读取 Agent、Skill、工具和知识库，会重新形成跨模块配置拼装层，增加状态不一致和未来远程化成本。因此 Skill 必须在 `AgentsService.getAgentRuntimeConfig()` 中完成解析。

## 5. 数据模型

### 5.1 AgentSkill

```prisma
model AgentSkill {
  id        String   @id @default(uuid()) @db.Uuid
  agentId   String   @map("agent_id") @db.Uuid
  skillId   String   @map("skill_id") @db.Uuid
  position  Int
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  agent     Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  skill     Skill    @relation(fields: [skillId], references: [id], onDelete: Cascade)

  @@unique([agentId, skillId], map: "uq_agent_skills_agent_skill")
  @@unique([agentId, position], map: "uq_agent_skills_agent_position")
  @@index([skillId], map: "idx_agent_skills_skill_id")
  @@map("agent_skills")
}
```

关系字段：

```prisma
model Agent {
  agentSkills AgentSkill[]
}

model Skill {
  agentSkills AgentSkill[]
}
```

设计说明：

- `position` 从 0 开始，由 Agent 绑定接口在每次全量替换时重新生成连续值。
- 不使用 `createdAt` 表达业务顺序；删除后重新绑定会改变创建时间。
- `enabled` 为绑定级开关，为后续临时关闭某个 Agent 的 Skill 保留能力。P0 前端全量选择时写入 `true`。
- Skill 删除采用软删除，但关系使用 `onDelete: Cascade` 防御未来物理清理。
- 绑定表不复制 Skill instructions，Skill 更新会在下一次 Run 生效。

### 5.2 迁移

新增迁移：

```text
backend/prisma/migrations/<timestamp>_add_agent_skill_bindings/migration.sql
```

现有 Agent 默认无 Skill 绑定，不影响当前对话。迁移不自动把任何 Skill 绑定到 Agent。

## 6. DTO 设计

### 6.1 绑定 DTO

```ts
type AgentSkillBindingItemDto = {
  skillId: string;
  position?: number;
  enabled?: boolean;
};

type AgentSkillBindingDto = {
  skills?: AgentSkillBindingItemDto[];
};

type AgentSkillBindingResult = {
  agentId: string;
  skills: Array<{
    skillId: string;
    position: number;
    enabled: boolean;
  }>;
};
```

规则：

- 前端按数组顺序提交；`position` 可省略，服务端以数组下标为准重新编号。
- 如果提交 `position`，必须与数组下标一致，避免一个请求中出现两个顺序来源。
- `skills=[]` 表示解除全部绑定。
- 最多绑定 10 个 Skill。
- Skill ID 必须非空、去重并属于当前 Workspace。
- 新绑定的 Skill 必须为 `enabled=true` 且 `deletedAt=null`。

### 6.2 Skill Runtime DTO

定义在 `skills/dto/skill.dto.ts`：

```ts
type SkillRuntimeConfig = {
  id: string;
  name: string;
  revision: number;
  instructions: string;
  usageConditions: string;
  inputGuidance: string;
  outputGuidance: string;
  limitations: string;
};
```

`SkillsService` 新增：

```ts
async getRuntimeSkills(skillIds: string[]): Promise<{
  active: SkillRuntimeConfig[];
  unavailableSkillIds: string[];
}>;
```

约束：

- 查询必须带 `workspaceId`、`enabled=true`、`deletedAt=null`。
- 返回 DTO，不返回 Prisma Skill。
- 返回顺序必须与 `skillIds` 输入顺序一致，不能使用数据库默认顺序。
- `unavailableSkillIds` 用于 Runtime 诊断，不暴露其他 Workspace 的 Skill 是否存在。

### 6.3 Agent Runtime DTO

扩展 `AgentRuntimeConfig`：

```ts
type AgentRuntimeSkill = SkillRuntimeConfig & {
  position: number;
};

type AgentRuntimeConfig = {
  // existing fields
  skills: AgentRuntimeSkill[];
  unavailableSkillBindings: Array<{
    skillId: string;
    reason: "DISABLED_OR_ARCHIVED";
  }>;
};
```

普通 Agent 详情增加 `skillIds: string[]`，用于编辑回填；列表项只增加 `skillCount`，不返回完整 Skill 内容。

## 7. API 设计

### 7.1 Skill 选项

新增轻量选项接口：

```text
GET /api/v1/skills/options
```

返回当前 Workspace 中启用且未归档的 Skill：

```json
[
  {
    "id": "...",
    "name": "技术方案评审",
    "description": "检查边界、风险和验收条件",
    "revision": 3
  }
]
```

成员是否可读取选项沿用 Agent 编辑权限：Workspace `OWNER/MANAGER/MEMBER` 均可读取；Skill 内容管理权限保持现状。

### 7.2 Agent Skill 绑定

```text
GET /api/v1/agents/:id/skills
PUT /api/v1/agents/:id/skills
```

更新请求：

```json
{
  "skills": [{ "skillId": "skill-a" }, { "skillId": "skill-b" }]
}
```

响应：

```json
{
  "agentId": "agent-id",
  "skills": [
    { "skillId": "skill-a", "position": 0, "enabled": true },
    { "skillId": "skill-b", "position": 1, "enabled": true }
  ]
}
```

Controller 只接收 DTO、获取当前用户、调用 `AgentsService` 并返回结果，不查询 Prisma。

### 7.3 更新事务

绑定采用全量替换：

```text
ensureCanManageAgent
-> normalize and deduplicate request
-> SkillsService.ensureBindableSkillIds
-> transaction:
     deleteMany(agentId)
     createMany(position = array index)
-> return persisted order
```

校验必须在事务前完成；删除和重建必须在同一事务中，避免 Runtime 观察到临时空集合。

## 8. Runtime 解析与稳定顺序

`AgentsService.getAgentRuntimeConfig()` 执行：

```text
1. 查询 Agent 及 agentSkills（position ASC, createdAt ASC, skillId ASC）
2. 过滤 binding.enabled=false
3. 按绑定顺序收集 skillIds
4. 调用 SkillsService.getRuntimeSkills(skillIds)
5. 按原 skillIds 映射回 position
6. 返回 skills 与 unavailableSkillBindings
```

稳定排序必须同时使用：

```ts
orderBy: [{ position: "asc" }, { createdAt: "asc" }, { skillId: "asc" }];
```

正常情况下唯一约束已保证 position 不重复，后两个字段用于处理迁移异常或未来约束调整后的确定性行为。

### 8.1 Skill 状态变化

| 场景                     | 绑定接口 | Runtime        |
| ------------------------ | -------- | -------------- |
| Skill 启用且有效         | 允许绑定 | 注入 Prompt    |
| Skill 后续被停用         | 保留绑定 | 跳过并记录诊断 |
| Skill 后续被归档         | 保留绑定 | 跳过并记录诊断 |
| Skill 属于其他 Workspace | 拒绝绑定 | 不暴露是否存在 |
| 绑定级 enabled=false     | 保存     | 跳过           |

不因单个 Skill 后续停用而让所有线上对话失败，但 Agent 编辑页必须显示“已失效绑定”并引导移除或重新启用。

## 9. Prompt Builder

### 9.1 渲染接口

扩展 `buildSystemPrompt`：

```ts
buildSystemPrompt(request: {
  systemPrompt: string;
  query: string;
  skills: AgentRuntimeSkill[];
  tools: LLMToolDefinition[];
  retrievalContext: RetrievalContext | null;
}): string;
```

Prompt Builder 保持纯函数，不调用 `SkillsService`。

### 9.2 最终组装顺序

```text
1. 平台固定安全规则（存在时）
2. Agent System Prompt
3. 当前用户问题提示
4. Skill Instructions（position 升序）
5. Tool 使用约束与可用工具
6. RAG Context
7. 会话历史（独立 messages）
8. 当前用户输入（独立 user message）
```

本次实现需要调整当前 Prompt Builder 中“RAG 早于工具规则”的顺序，使其与平台路线图保持一致。冲突优先级固定为：

```text
平台规则 > Agent 规则 > Skill 规则 > Tool/RAG 内容 > 用户输入中的指令
```

### 9.3 Skill 渲染格式

每个 Skill 使用明确边界，避免多个 Skill 内容粘连：

```text
已启用 Skill（按配置顺序执行；与 Agent 规则冲突时以 Agent 规则为准）：

<skill id="skill-id" name="技术方案评审" revision="3" position="0">
适用条件：...
执行说明：...
输入要求：...
输出要求：...
限制：...
</skill>
```

渲染规则：

- 字段为空时不输出对应行。
- Skill 名称和内容按纯文本处理，不允许其闭合外层边界；渲染前把 `<skill`、`</skill>` 转义为普通文本。
- `usageConditions` 只作为模型采用 Skill 的指导，不触发额外分类调用。
- Skill 顺序严格使用 `position`，禁止按名称或更新时间重新排序。
- 不在普通日志中保存完整 Skill instructions，只记录 ID、revision、字符数和摘要哈希。

### 9.4 Prompt 预算

P0 使用确定性字符预算：

```text
MAX_AGENT_SKILLS = 10
MAX_SINGLE_SKILL_PROMPT_CHARS = 12_000
MAX_TOTAL_SKILL_PROMPT_CHARS = 30_000
```

现有 Skill 字段上限理论上可能超过单 Skill 预算，因此 Renderer 必须按以下顺序裁剪：

```text
保留 name、usageConditions、instructions
-> 裁剪 inputGuidance
-> 裁剪 outputGuidance
-> 裁剪 limitations
-> 最后裁剪 instructions 并添加 [内容已裁剪]
```

按 position 依次消耗总预算。预算耗尽后的 Skill 不注入，并在 Trace 中记录 `PROMPT_BUDGET_EXCEEDED`。不得静默改变前面 Skill 的顺序。

## 10. Run Trace 与可观测性

在模型调用前增加：

```text
TRANSFORM · skill_prompt
```

输入：

```json
{
  "bindings": [
    { "skillId": "skill-a", "position": 0 },
    { "skillId": "skill-b", "position": 1 }
  ]
}
```

输出：

```json
{
  "applied": [{ "skillId": "skill-a", "revision": 3, "position": 0, "renderedChars": 1250 }],
  "skipped": [{ "skillId": "skill-b", "reason": "DISABLED_OR_ARCHIVED" }],
  "totalRenderedChars": 1250,
  "promptHash": "sha256:..."
}
```

禁止在 Trace 中写入完整 instructions、完整 Prompt 或 MCP 导入原文。

## 11. 前端设计

### 11.1 数据加载

打开 Agent 编辑弹窗时并行加载：

```text
Agent Detail
Skill options
Agent Skill bindings
现有工具与知识库选项
```

`AgentsPage` 保存顺序：

```text
保存 Agent 基础配置
-> Promise.all:
     保存工具绑定
     保存知识库绑定
     保存 Skill 绑定
```

三个绑定接口独立失败时保留现有错误汇总逻辑，并重新读取服务端最终状态。

### 11.2 AgentFormModal

新增“Skill”页签或绑定区域：

```text
Skill（2）
┌──────────────────────────────────────┐
│ ⋮⋮  技术方案评审      revision 3  × │
│ ⋮⋮  结构化输出规范    revision 1  × │
└──────────────────────────────────────┘
[添加 Skill]
```

要求：

- 只展示启用 Skill 作为新增选项。
- 使用拖拽或上移/下移按钮调整顺序；键盘操作必须可用。
- 已停用/归档但仍绑定的项显示警告，不允许重新添加，只允许移除。
- 展示 Skill 描述、revision 和预计 Prompt 字符数。
- Agent 摘要增加 Skill 数量。
- 表单值使用有序 `skillIds: string[]`；提交时转换为绑定 DTO。

## 12. 权限、安全与一致性

1. Agent Skill 绑定沿用 Agent 管理权限和 Workspace 隔离。
2. `SkillsService` 对未知、停用、归档和跨 Workspace ID 返回统一错误，不泄露资源存在性。
3. Skill 内容是不可信配置文本，只能影响模型 Prompt，不能改变后端权限、工具授权或网络策略。
4. Skill 声称可以使用某工具，不代表 Agent 获得该工具；实际工具清单仍以 `AgentTool` 为准。
5. Skill 声称可以访问某知识库，不代表 Agent 获得知识库权限；实际检索仍以 `AgentKnowledgeBase` 为准。
6. Skill 的启停与内容更新使用现有 revision 乐观锁；Agent 绑定更新使用全量事务替换。
7. P0 的已发布 Agent 会读取 Skill 最新 revision，这是已知动态行为；V3 `AgentVersion` 必须保存 Skill revision 快照。

## 13. 错误模型

在 `ErrorCodes.agent` 增加：

| 错误码名称         | 用户提示                          |
| ------------------ | --------------------------------- |
| `invalidSkills`    | Skill 绑定参数不合法              |
| `skillUnavailable` | 所选 Skill 已停用、归档或不可访问 |
| `tooManySkills`    | Agent 最多绑定 10 个 Skill        |

运行时跳过停用或归档 Skill 不返回对话错误，只写 Trace 和运维警告。

## 14. 实施顺序

1. 新增 `AgentSkill` Prisma 模型、关系和迁移。
2. 在 `SkillsService` 增加 options、绑定校验和 Runtime DTO 查询。
3. 在 `agents/dto` 增加绑定 DTO、详情字段和 Runtime Skill DTO。
4. 在 `AgentsService` 增加 GET/PUT 绑定用例和事务替换。
5. 扩展 `getAgentRuntimeConfig()`，按稳定顺序解析有效 Skill。
6. 扩展 Prompt Builder，增加 Skill Renderer、预算和固定组装顺序。
7. 在 Agent Runtime 增加 `skill_prompt` Trace Step。
8. 前端增加 Skill options、绑定 API、表单选择和顺序调整。
9. 补充迁移、Service、Prompt、Runtime 和前端类型测试。

## 15. 测试与验收

### 15.1 SkillsService

- 只返回当前 Workspace 启用且未归档 Skill。
- Runtime DTO 顺序与输入 ID 顺序一致。
- 跨 Workspace、停用和归档 ID 统一判定为不可绑定。
- 不返回 `sourceRef`、`sourceHash` 或创建者等非 Runtime 字段。

### 15.2 AgentsService

- 空数组解除全部绑定。
- 重复 ID、超过数量和非法 position 被拒绝。
- 删除旧绑定和创建新绑定处于同一事务。
- GET 按 `position` 稳定返回。
- Runtime 跳过失效 Skill，并保留有效 Skill 的相对顺序。

### 15.3 Prompt Builder

- 无 Skill 时输出与改造前兼容。
- 多 Skill 严格按 position 注入。
- 空字段不产生无意义标签。
- Skill 边界字符串被转义。
- 单项预算和总预算裁剪可预测。
- Agent Prompt、Skill、Tool 和 RAG 顺序固定。

### 15.4 Runtime

- `skill_prompt` Step 不保存完整 Skill 内容。
- Step 记录 ID、revision、position、字符数、hash 和跳过原因。
- Skill 停用不导致整次对话失败。
- Tool 权限不因 Skill 文本而扩大。

### 15.5 前端

- 创建和编辑 Agent 可以选择、移除并排序 Skill。
- 编辑时正确回填绑定顺序。
- 停用 Skill 显示失效状态。
- 保存后重新打开，顺序与服务端一致。

## 16. P0 最终调用链

```text
Agent 编辑
  -> PUT /agents/:id/skills
  -> AgentsService 校验 Agent 权限
  -> SkillsService 校验 Skill 可绑定
  -> AgentSkill 全量事务替换

Chat / External Access
  -> AgentRuntime.runAgent
  -> AgentsService.getAgentRuntimeConfig
       -> 读取 AgentSkill 稳定顺序
       -> SkillsService.getRuntimeSkills
       -> 返回 AgentRuntimeConfig.skills
  -> Skill Renderer 执行预算与边界转义
  -> TRANSFORM · skill_prompt Trace
  -> Prompt Builder 按 Agent / Skill / Tool / RAG 顺序组装
  -> ModelProvidersService.streamChatCompletion
```

该方案只把 Skill 作为受控、可复用、可审计的 Prompt 指令接入 Agent，不扩大工具和知识库授权，也不提前引入自动 Skill 路由或不可变 AgentVersion。
