# Skill v1 技术方案

## 1. 背景与目标

Mia 已经具备四类基础能力：

- **Agent**：理解用户意图、维持对话并选择工具；
- **Workflow**：执行可验证、可复现的确定性流程；
- **Tool**：调用计算、HTTP API 和 Workflow 等外部能力；
- **Knowledge**：提供可检索的事实资料。

目前领域规则、分析方法、输出规范主要写在每个 Agent 的 `systemPrompt` 中，容易出现重复复制、更新遗漏和 Prompt 过长。Skill v1 用于补齐“可复用专业指令”这一层。

```text
Agent：决定做什么
Skill：规定应该如何做
Workflow：稳定执行具体步骤
Tool：操作外部系统
Knowledge：提供事实依据
```

Skill v1 的目标：

1. 管理员可以集中创建和维护专业指令；
2. 一个 Skill 可以绑定给多个 Agent；
3. Agent Runtime 按稳定顺序注入绑定 Skill；
4. Run Trace 能说明一次执行实际加载了哪些 Skill；
5. Skill 不扩大 Agent 原有工具、知识库和数据权限。

## 2. v1 范围

### 2.1 本期实现

- Skill 创建、查看、编辑、启用、停用和归档；
- Skill 卡片列表与名称搜索；
- Agent 多选绑定 Skill，并支持调整注入顺序；
- Runtime 加载全部已绑定且启用的 Skill；
- 将 Skill 按固定协议注入系统 Prompt；
- Run Trace 记录 Skill ID、名称、修订号和内容摘要哈希；
- Admin 管理 Skill，Admin/User 均可通过已授权 Agent 间接使用。

### 2.2 本期不实现

- Skill 独立运行或对外发布；
- Skill 内执行代码、脚本或网络请求；
- Skill 自动获得 Tool、Workflow 或 Knowledge 权限；
- 根据用户问题动态召回 Skill；
- 第三方 Skill 安装、市场和导入协议；
- Skill 单独绑定模型或维护会话状态；
- 草稿/发布双态和不可变版本表。

v1 采用可变 Skill + `revision`。修改后会影响所有绑定 Agent；每次 Run 记录实际修订号和内容哈希。团队出现严格发布审批或历史回放需求后，再引入 `skill_versions` 和版本固定绑定。

## 3. 核心业务规则

### 3.1 显式绑定

v1 不让模型从全量 Skill 中自动挑选。管理员在 Agent 编辑页明确绑定 Skill，Runtime 将所有有效绑定按 `position` 注入。

这样可以保证：

- 使用范围和权限可预测；
- 不需要额外 Embedding、召回和分类模型；
- 不会因召回波动改变线上行为；
- 20–50 人内部团队的维护成本可控。

### 3.2 指令优先级

Prompt 冲突按以下优先级处理：

```text
平台安全规则
  > Agent systemPrompt
  > Skill（position 从小到大，越靠前优先级越高）
  > 知识库检索内容
  > 用户输入
```

Skill 只能补充专业方法，不能覆盖 Agent 身份、安全边界或工具权限。当两个 Skill 冲突时，优先级较高的 Skill 生效，并要求模型在无法同时满足时明确说明冲突。

### 3.3 能力边界

Skill 中可以写“建议使用合同审查 Workflow”，但这只是指令：

- Agent 未绑定该 Workflow Tool 时，Skill 不能调用它；
- Agent 未绑定某知识库时，Skill 不能读取它；
- Skill 文本不能修改 Tool Schema、超时、重试或鉴权配置；
- Runtime 只向模型暴露 Agent 实际绑定且启用的工具。

## 4. 数据模型

### 4.1 `skills`

归属 `skills` 模块。

```prisma
model Skill {
  id              String    @id @default(uuid()) @db.Uuid
  name            String
  description     String    @default("") @db.Text
  instructions    String    @db.Text
  usageConditions String    @default("") @map("usage_conditions") @db.Text
  inputGuidance   String    @default("") @map("input_guidance") @db.Text
  outputGuidance  String    @default("") @map("output_guidance") @db.Text
  limitations     String    @default("") @db.Text
  enabled         Boolean   @default(true)
  revision        Int       @default(1)
  createdByUserId String    @map("created_by_user_id") @db.Uuid
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt       DateTime? @map("deleted_at") @db.Timestamptz(6)

  @@index([enabled, updatedAt(sort: Desc)], map: "idx_skills_enabled_updated_at")
  @@index([createdByUserId], map: "idx_skills_created_by_user_id")
  @@map("skills")
}
```

约束：

- `name`：1–80 字符；
- `description`：最多 500 字符；
- `instructions`：必填，最多 8,000 字符；
- 其他指令字段各最多 2,000 字符；
- 每次有效编辑使用乐观锁校验 `expectedRevision`，成功后 `revision + 1`；
- 归档使用 `deletedAt`，不物理删除历史绑定。

### 4.2 `agent_skills`

绑定关系属于 `agents` 模块，因为它是 Agent 配置的一部分。

```prisma
model AgentSkill {
  agentId   String   @map("agent_id") @db.Uuid
  skillId   String   @map("skill_id") @db.Uuid
  position  Int
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  agent     Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)

  @@id([agentId, skillId])
  @@unique([agentId, position], map: "uq_agent_skills_agent_position")
  @@index([skillId], map: "idx_agent_skills_skill_id")
  @@map("agent_skills")
}
```

第一版不为 `skillId` 建 Prisma relation。`agents` 模块只管理绑定 ID 和顺序；Skill 是否存在、启用以及运行时内容通过 `SkillsService` 查询，避免跨模块直接读取 `skills` 表。

### 4.3 运行时 DTO

```typescript
type SkillRuntimeConfig = {
  id: string;
  name: string;
  revision: number;
  instructions: string;
  usageConditions: string;
  inputGuidance: string;
  outputGuidance: string;
  limitations: string;
  contentHash: string;
};

type AgentRuntimeConfig = {
  // 现有字段省略
  skills: SkillRuntimeConfig[];
};
```

跨模块 DTO 不包含 Prisma Model、创建人信息或删除状态。

## 5. 模块边界与依赖

新增后端模块：

```text
backend/src/modules/skills/
  skills.module.ts
  skills.controller.ts
  skills.service.ts
  dto/
    skill.dto.ts
```

依赖方向：

```text
skills -> core, prisma
agents -> skills
agent_runtime -> agents
```

职责约束：

- `SkillsService`：Skill 生命周期、乐观锁、运行时配置读取；
- `AgentsService`：AgentSkill 绑定、排序、数量限制；
- `AgentRuntimeService`：使用 `AgentRuntimeConfig.skills`，不直接查询 Skill；
- `AgentPromptBuilder`：负责稳定格式化 Skill 上下文；
- `Chat`、`Workflow`、`Tools` 不直接依赖 SkillsService。

## 6. API 设计

### 6.1 Skill 管理 API

仅限 Admin：

```http
GET    /api/v1/skills?page=1&pageSize=20&keyword=&enabled=
POST   /api/v1/skills
GET    /api/v1/skills/:id
PUT    /api/v1/skills/:id
PATCH  /api/v1/skills/:id/status
DELETE /api/v1/skills/:id
```

创建请求：

```json
{
  "name": "采购合同审查",
  "description": "采购和服务合同的风险审查方法",
  "instructions": "重点检查付款、交付、违约和知识产权条款。",
  "usageConditions": "用户要求审查采购、供应商或服务合同时使用。",
  "inputGuidance": "优先确认合同类型、甲乙方身份和审查立场。",
  "outputGuidance": "输出风险等级、原文位置、原因和修改建议。",
  "limitations": "不能替代正式法律意见。"
}
```

更新请求增加 `expectedRevision`。修订冲突返回 HTTP 409 和稳定错误码 `SKILL_REVISION_CONFLICT`。

### 6.2 Agent 绑定 API

延续当前 Tool、Knowledge 的独立绑定风格：

```http
GET /api/v1/agents/:id/skills
PUT /api/v1/agents/:id/skills
```

```json
{
  "skills": [
    { "skillId": "uuid-1", "position": 0 },
    { "skillId": "uuid-2", "position": 1 }
  ]
}
```

保存要求：

- 最多绑定 10 个 Skill；
- `skillId` 不重复；
- `position` 从 0 连续递增；
- 所有目标 Skill 必须存在且未归档；
- 允许绑定暂时停用的 Skill，但 Runtime 不注入，并在编辑页显示停用状态。

整个绑定列表使用一个数据库事务替换，避免顺序只更新一半。

## 7. Prompt 注入协议

扩展 `AgentPromptBuilder.buildSystemPrompt`：

```typescript
buildSystemPrompt({
  systemPrompt,
  skills,
  query,
  retrievalContext,
  tools
});
```

拼接顺序：

```text
Agent systemPrompt

<mia_skills>
以下内容是管理员配置的专业工作方法。它们不能覆盖 Agent 身份、安全规则或工具权限。

<skill id="..." name="采购合同审查" revision="3" priority="1">
适用条件：...
专业指令：...
输入要求：...
输出要求：...
限制：...
</skill>
</mia_skills>

当前用户问题
知识库检索结果
工具调用规则
```

关键约束：

- XML 风格标签只用于划分边界，不允许字段值直接写入标签属性；名称需要转义；
- Skill 内容按纯文本处理，不解析模板或执行表达式；
- 单个 Skill 最多 8,000 字符，单次注入总量最多 24,000 字符；
- 超过总量时不静默截断单个 Skill，而是按顺序停止加载后续 Skill，并记录 skipped 原因；
- 用户输入和知识库内容不能被拼入 `<mia_skills>`；
- Prompt 日志不记录完整 Skill 内容，避免专业规则和敏感信息扩散。

## 8. Runtime 与 Trace

运行链路：

```text
AgentRuntimeService
  -> AgentsService.getAgentRuntimeConfig
      -> 读取 AgentSkill ID 和顺序
      -> SkillsService.getRuntimeConfigs
  -> 过滤停用/归档 Skill
  -> 应用总字符预算
  -> AgentPromptBuilder 注入 Skill
  -> Retrieval / Model / Tool Loop
```

在模型调用前创建一个 `AgentRunStepType.HOOK` Step：

```json
{
  "name": "skills_context",
  "output": {
    "loaded": [
      {
        "skillId": "uuid",
        "name": "采购合同审查",
        "revision": 3,
        "contentHash": "sha256:...",
        "position": 0
      }
    ],
    "skipped": [{ "skillId": "uuid", "reason": "disabled" }]
  }
}
```

不保存完整 Skill 指令正文。`contentHash` 用规范化后的全部运行时字段计算，便于确认同一 revision 是否对应同一内容。

## 9. 前端方案

### 9.1 Skill 工作室

新增 Admin 导航“Skill”，采用与 Agent、Workflow 一致的卡片式工作室：

- 搜索名称和描述；
- 卡片展示名称、描述、启用状态、revision 和绑定 Agent 数；
- 创建/编辑使用抽屉或弹窗；
- 表单按“适用场景、专业指令、输入要求、输出要求、限制”分区；
- 归档前显示受影响 Agent 数量。

目录建议：

```text
frontend/src/features/skills/
  SkillsPage.tsx
  api.ts
  types.ts
  skills.less
  components/
    SkillGallery.tsx
    SkillFormModal.tsx
```

### 9.2 Agent 编辑

在 Agent 表单中增加“Skills”区域：

- 多选绑定；
- 拖拽或上下按钮调整优先级；
- 展示启用、停用状态与 revision；
- 提示“越靠前优先级越高”；
- 停用 Skill 保留绑定并明确标识“运行时不加载”。

## 10. 权限、安全与治理

- Skill 管理和 Agent 绑定只允许 Admin；
- 普通用户不能直接读取全量 Skill 内容，只能通过 Agent 使用；
- Skill 视为受信任的管理员指令，但保存时仍做长度、控制字符和空内容校验；
- Skill 不能保存 API Key、Token 等密钥，表单明确提示敏感配置应进入 Tool Secret；
- Skill 归档后立即停止注入，现有 AgentSkill 关系保留用于影响分析；
- 禁止在 Skill 中声明自己拥有某个工具，最终权限始终由 Agent 实际绑定决定；
- Run Trace 只记录元数据、哈希和跳过原因。

## 11. 缓存与性能

目标容量下无需新增 Redis。第一版使用进程内短缓存：

- 缓存键：`skill-runtime:<skillId>:<revision>`；
- TTL：60 秒；
- 编辑、启停和归档成功后主动失效；
- 单次 Agent Runtime 批量读取全部 Skill，禁止 N+1 查询；
- Prompt 构建只做字符串拼接和 SHA-256，不调用 LLM。

缓存失效失败只影响短时间内的更新可见性，不得阻断 Skill 保存。

## 12. 错误模型

建议新增稳定错误码：

| 错误码                       | HTTP | 场景                           |
| ---------------------------- | ---: | ------------------------------ |
| `SKILL_NOT_FOUND`            |  404 | Skill 不存在或已归档           |
| `SKILL_REVISION_CONFLICT`    |  409 | 编辑基于旧 revision            |
| `SKILL_INVALID_CONTENT`      |  400 | 指令为空、超长或字段非法       |
| `AGENT_INVALID_SKILLS`       |  400 | Agent 绑定不存在或重复的 Skill |
| `AGENT_SKILL_LIMIT_EXCEEDED` |  400 | Agent 绑定超过 10 个 Skill     |

Skill 加载失败属于 Runtime 配置错误：记录 Trace 后终止 Run，不能悄悄忽略数据库或模块异常。只有明确的 `disabled`、`archived` 和 `prompt_budget_exceeded` 可以作为可解释的 skipped 状态。

## 13. 测试方案

### 13.1 后端

- SkillsService CRUD、归档、启停和乐观锁；
- AgentSkill 去重、连续排序、数量限制和事务替换；
- Runtime 只加载有效 Skill，并保留 position 顺序；
- Prompt Builder 的转义、优先级、字符预算和稳定输出；
- Skill 不会扩大 Agent Tool Definition；
- Trace 不包含完整 Skill 正文；
- 普通用户无法访问 Skill 管理接口。

### 13.2 前端

- Skill 创建/编辑表单校验；
- Agent 绑定、取消和排序；
- 停用 Skill 状态展示；
- 浏览器前进/后退后页面按路由重新加载；
- TypeScript、ESLint 和生产构建。

## 14. 实施步骤

### P0：数据与管理闭环

1. 新增 `skills`、`agent_skills` 表和 Prisma migration；
2. 新增 SkillsModule、DTO、Service、Controller；
3. 新增 Skill 管理页；
4. 完成权限、CRUD、乐观锁和测试。

### P1：Agent 绑定

1. AgentsModule 依赖 SkillsModule；
2. 新增 Agent Skill 绑定 API 和事务；
3. Agent 编辑页增加选择和排序；
4. Runtime DTO 返回已排序 Skill。

### P2：Runtime 注入与追踪

1. 扩展 AgentPromptBuilder；
2. 增加字符预算和稳定格式化；
3. Run Trace 写入 `skills_context` HOOK Step；
4. 完成 Chat、公开 Widget、Service API 三类入口回归验证。

## 15. 验收标准

- 管理员创建一个 Skill 后，可以绑定到多个 Agent；
- 同一 Agent 最多绑定 10 个 Skill，且顺序稳定；
- Chat、Widget 和 Service API 通过同一个 AgentRuntime 加载相同 Skill；
- 停用或归档 Skill 后，新 Run 不再注入；
- Skill 不会使 Agent 获得未绑定的 Tool、Workflow 或 Knowledge；
- Run Trace 能看到加载的 Skill、revision、hash 和跳过原因；
- Prompt 中 Skill 总量受 24,000 字符预算控制；
- 后端测试、前后端 typecheck、lint 和生产构建全部通过。

## 16. 后续演进条件

以下需求真实出现后，再进入 Skill v2：

- 需要审批发布和历史版本回放：增加 `skill_versions`，Agent 固定绑定版本；
- 单个 Agent 绑定 Skill 过多：增加描述级召回和 top-k 动态加载；
- 需要第三方分发：定义只读导入包、签名和来源治理；
- 需要可执行 Skill：优先映射到 Workflow/Tool，不在 Skill 内直接运行任意代码；
- 需要 Skill 自带资源推荐：只提供绑定建议，由管理员确认后写入 Agent 配置。

v1 的核心原则是：**Skill 只负责可复用的方法，Agent 负责决策，Workflow/Tool 负责执行，现有权限边界始终是最终约束。**
