# 模块交付 Skill

## 触发条件

当需要开发一个新的业务模块，或把一个已有 mock/原型模块接入真实后端时使用。

适用模块示例：

- Provider
- Agent
- Knowledge
- Chat
- Logs
- Tools

## 核心原则

- 先咨询定边界，再进入代码实现。
- 先确定数据模型，再写后端业务。
- 后端按分层逐步实现，每一步都要编译或 curl 验证。
- 前端先建 API 对接层，再把 mock 数据源替换成真实 API。
- 最后必须做后端 curl + 浏览器全流程验收。
- 不确定的架构选择、接口契约、数据模型、依赖引入，必须等待用户确认。

## 标准流程

### 1. 咨询与范围梳理

目标：先把业务边界、模块职责、外部依赖和不做什么说清楚。

必须梳理：

- 模块要解决什么问题。
- 这个模块有哪些核心业务操作。
- 哪些能力属于一期必须做。
- 哪些能力后置或不做。
- 是否涉及外部系统或第三方 API。
- 是否影响已有模块边界。
- 是否需要新增依赖。

产出物：

- 模块功能范围清单。
- 模块不做事项。
- 关键业务流程。
- 可能的边界问题和风险点。

验证方式：

- 用一段简短说明复述模块目标。
- 列出核心操作清单，例如创建、查询、更新、删除、测试连接、同步等。
- 如果有 2-3 个可选方案，必须做对比。

等待用户确认：

- 模块范围。
- 一期做什么、不做什么。
- 供应商/外部服务选型。
- 是否引入新依赖。
- 架构或数据归属存在分歧时。

注意事项：

- 不要一上来直接写代码。
- 不要把 Dify/Mia 这类平台型能力一次性都搬进来。
- 不要因为未来可能需要就提前做复杂抽象。

### 2. 接口契约设计

目标：先把前后端契约定住，避免后端实现完后前端再反复猜字段。

必须定义：

- HTTP 方法。
- 路径。
- 入参。
- 出参。
- 是否分页。
- 删除时是否需要关联检查。
- 非 CRUD 操作的动词路径。

路径规则：

```text
/api/v1/{资源复数名}
```

示例：

```text
GET    /api/v1/providers
POST   /api/v1/providers
GET    /api/v1/providers/{id}
PUT    /api/v1/providers/{id}
DELETE /api/v1/providers/{id}
POST   /api/v1/providers/{id}/test-connection
```

产出物：

- 接口列表。
- 每个接口的请求 DTO。
- 每个接口的响应 DTO。
- 错误码清单。
- 删除关联检查说明。

验证方式：

- 检查所有普通 JSON 接口是否返回 `Result<T>`。
- 检查列表接口是否支持 `page`、`pageSize`。
- 检查非 CRUD 操作是否使用动词路径。
- 检查错误码是否归属到正确模块分段。

等待用户确认：

- 接口路径。
- 入参和出参。
- 删除策略，尤其是软删除、关联检查、级联删除。
- 非 CRUD 操作是否需要做。

注意事项：

- 不要为了前端方便随意破坏 REST 路径规范。
- 不要在接口里返回敏感字段，例如 API key 明文。
- 不要把内部数据库字段直接暴露成接口契约。

### 3. 数据模型设计

目标：先确定表、关系、索引和数据归属，再实现业务。

必须明确：

- 表名。
- 表归属模块。
- 表之间关系。
- 是否软删除。
- 唯一约束。
- 外键关系。
- 关键索引。
- 是否可能成为大表。
- 是否需要迁移脚本。

产出物：

- 数据表关系说明。
- `prisma/schema.prisma` 或 `schema.sql` 修改。
- migration 文件。
- 核心索引。

验证方式：

- Prisma 项目执行：

```bash
npm run prisma:generate
DATABASE_URL=postgresql://mia:mia@127.0.0.1:5432/mia npm --prefix backend exec prisma validate
```

- SQL 项目执行对应的 migration 校验。
- 检查外键字段是否有索引。
- 检查唯一约束是否考虑软删除。
- 检查大表是否预留分页/归档策略。

等待用户确认：

- 表结构。
- 表之间关系。
- 软删除还是物理删除。
- 唯一约束。
- 是否保存敏感字段，以及敏感字段如何加密。

注意事项：

- 不要先写 Service 再反推表结构。
- 不要忘记迁移文件。
- 不要只改 schema 不生成 client。
- Prisma 新增模型后必须执行 `prisma generate`，否则 TypeScript 类型仍是旧的。
- Prisma validate 需要 `DATABASE_URL`，本地没 `.env` 时要临时传入环境变量。

### 4. 后端分层实现

目标：按固定层次实现，不跨层、不跳层。

推荐顺序：

```text
DB schema / Entity
-> Mapper / 转换函数
-> DTO
-> Service
-> Controller
```

NestJS + Prisma 项目对应：

```text
prisma/schema.prisma
-> service 内部 mapper / toXxx 方法
-> dto/
-> *.service.ts
-> *.controller.ts
-> *.module.ts
```

Service 负责：

- CRUD。
- 业务校验。
- 关联检查。
- 连通性测试。
- 模型同步。
- 健康检查。
- 调用外部 API。
- 写日志或预留日志点。

Controller 负责：

- 定义路由。
- 接收参数。
- 调用 Service。
- 返回 DTO。

产出物：

- Module 文件。
- Controller 文件。
- Service 文件。
- DTO 文件。
- Mapper/转换函数。
- 必要的错误码。
- 必要的外部 API client。

验证方式：

- 每完成一个后端小步骤，执行：

```bash
npm run typecheck:api
npm run build:api
```

- Controller 完成后启动后端，确认路由注册。
- 对关键接口用 curl 验证。

等待用户确认：

- Service 中出现新的业务规则。
- 是否引入新 npm 依赖。
- 外部 API 的调用策略。
- 超时、重试、熔断默认值。

注意事项：

- 不要在 Controller 写业务逻辑。
- 不要在前端尚未需要时过度设计后端响应。
- 不要跳过关联检查，例如删除 Provider 前要检查是否还有 Model Config。
- 所有外部调用必须有超时。
- 配置项必须外化，不能硬编码。
- 保存 API key 等敏感字段时必须加密或至少避免明文返回。

### 5. 后端接口验证

目标：前端接入前，先确认后端接口独立可用。

必须验证：

- 列表接口。
- 创建接口。
- 详情接口。
- 更新接口。
- 删除接口。
- 特殊操作接口，例如 test-connection、sync-models、health-check。
- 错误响应。
- 分页响应。
- 关联检查。

产出物：

- curl 命令或等价验证记录。
- 通过/失败结果。
- 发现的问题和修复记录。

验证方式示例：

```bash
curl -s http://127.0.0.1:8000/api/v1/providers
curl -s -X POST http://127.0.0.1:8000/api/v1/providers \
  -H "Content-Type: application/json" \
  -d '{"name":"Local Ollama","providerType":"OLLAMA","baseUrl":"http://127.0.0.1:11434","enabled":true}'
```

等待用户确认：

- 接口行为和预期不一致时。
- curl 验证需要真实第三方 API key 时。
- 是否继续扩展特殊操作。

注意事项：

- 不要等前端接入后才发现后端接口不可用。
- 不要只验证成功路径，也要验证错误路径。
- 数据库没启动时，先说明阻塞点，不要假装完成真实落库验证。

### 6. 前端 API 对接

目标：先建立 API 文件，再替换页面 mock 数据源。

必须做：

- 在对应 feature 下创建 API 文件。
- 定义前端类型。
- 对接后端接口。
- 保持 `Result<T>` 解包逻辑统一走 shared API client。
- 页面不直接写 fetch。

产出物：

- `features/{module}/api.ts`。
- 前端 DTO/type。
- 页面中的 mock 数据源替换为真实 API。

验证方式：

```bash
npm run typecheck:web
npm run build:web
```

等待用户确认：

- 页面交互方式有多种选择时。
- 是否引入 UI 库、表单库、请求缓存库。
- 是否保留 mock 模式。

注意事项：

- 不要在页面组件里散落 fetch。
- 不要让页面直接依赖后端内部字段。
- 空列表返回 `[]`，不要让前端处理 `null` 列表。
- loading、error、success 状态都要有。

### 7. 前端页面实现

目标：让用户能通过浏览器完成完整业务操作。

必须覆盖：

- 列表展示。
- 创建表单。
- 编辑表单。
- 删除操作。
- 特殊操作按钮。
- loading 状态。
- error 状态。
- success 提示。

产出物：

- 页面组件。
- 必要样式。
- 必要的状态管理。
- 前端入口接入。

验证方式：

- 前端 typecheck。
- 前端 build。
- 浏览器打开页面。
- 手动走完整流程。

等待用户确认：

- 页面布局有明显产品选择时。
- 操作是否需要二次确认。
- 删除是否允许一键执行。

注意事项：

- 不要先追求漂亮 UI，先保证业务闭环。
- 不要引入 UI 库，除非用户确认。
- 表格和表单必须在移动端不崩。

### 8. 完整验收

目标：确认模块从数据库、后端、前端到浏览器流程都可用。

必须验收：

- 数据库 migration 已执行。
- 后端接口 curl 验证通过。
- 前端页面能加载真实数据。
- 浏览器能完成全流程。
- 刷新页面后数据仍存在。
- 错误路径有明确提示。

Provider 模块验收示例：

```text
1. 创建 Provider
2. 列表出现 Provider
3. 编辑 Provider
4. 测试连接
5. 创建 Model Config
6. 列表出现 Model Config
7. 删除 Model Config
8. 删除 Provider
9. 刷新页面确认状态一致
```

产出物：

- 验收结果说明。
- 未完成项。
- 已知风险。
- 下一步建议。

验证方式：

```bash
npm run typecheck
npm run build
```

并执行：

```bash
npm run db:up
npm run prisma:deploy
npm run dev:api
npm run dev:web
```

等待用户确认：

- 需要真实账号/API key 才能验收的外部 API。
- 浏览器行为和用户预期不一致时。
- 是否进入下一个模块。

注意事项：

- Docker/Postgres 不可用时，必须明确说明未完成真实落库验收。
- 不要把 typecheck/build 通过当成完整业务验收。
- 不要遗漏浏览器刷新后的持久化确认。

## 常见坑

### 1. Prisma Client 类型还是旧的

现象：

```text
Property 'xxx' does not exist on type PrismaClient
Module '@prisma/client' has no exported member ...
```

原因：

- 改了 `schema.prisma`，但没有执行 `prisma generate`。
- `prisma generate` 和 typecheck 并行执行，typecheck 读到了旧类型。

处理：

```bash
npm run prisma:generate
npm run typecheck:api
```

### 2. Prisma validate 找不到 DATABASE_URL

现象：

```text
Environment variable not found: DATABASE_URL
```

处理：

```bash
cp backend/.env.example backend/.env
```

或：

```bash
DATABASE_URL=postgresql://mia:mia@127.0.0.1:5432/mia npm --prefix backend exec prisma validate
```

### 3. 后端接口写好了但数据库没迁移

现象：

- 后端编译通过。
- curl 失败。
- 报表不存在或枚举不存在。

处理：

```bash
npm run db:up
npm run prisma:deploy
```

### 4. Provider 删除遗漏关联检查

风险：

- Provider 删除后，Model Config 还指向它。
- 后续 Agent 调用模型时失败。

处理：

- 删除 Provider 前检查是否存在未删除的 Model Config。
- 有关联时返回冲突错误。

### 5. 外部调用没有超时

风险：

- test-connection 卡住。
- Chat/SSE 长时间占用连接。

处理：

- 所有外部 API 调用必须设置 timeout。
- Node 里可用 `AbortSignal.timeout(ms)`。

### 6. API key 明文泄露

风险：

- API 返回 Provider 详情时把 key 明文返回。
- 日志记录了 key。

处理：

- API key 存储时加密。
- 接口响应不返回 key。
- 编辑表单里只允许重新填写或清空。

### 7. 前端直接写 fetch

风险：

- Result 解包逻辑重复。
- 错误处理不一致。

处理：

- 每个模块建立 `features/{module}/api.ts`。
- 页面只调用 API 文件。

### 8. 只做构建验证，没有浏览器验收

风险：

- typecheck/build 都通过，但实际页面流程不可用。

处理：

- 每个模块最后必须做浏览器完整流程。
- 至少覆盖创建、列表、编辑、删除、特殊操作。

## 交付完成标准

一个模块只有同时满足以下条件，才算交付完成：

- 范围和接口契约已确认。
- 数据模型和 migration 已完成。
- 后端分层实现完成。
- 后端 curl 验证通过。
- 前端 API 对接完成。
- 前端页面完成。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- 浏览器全流程验收通过。
- 未完成项和风险已明确说明。

