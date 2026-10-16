# 会话历史与三级上下文裁剪技术方案

## 1 结论

Mia 将完整会话记录与单次模型上下文分离。保留型会话的 user 和 assistant 消息继续完整写入 PostgreSQL，Tool Result 与 RAG 执行信息保存在助手消息 metadata 和运行追踪中；每次调用模型前，再从这些数据生成受总 Token 预算约束的临时消息数组。裁剪不会回写或覆盖数据库原文。

最终上下文采用三级裁剪：先从数据库读取最近轮次窗口，再限制单条内容大小，最后把系统提示词、历史、RAG、Tool Result 和当前输入放入同一个 Token 预算池，根据必需性、优先级、相关度和新近度统一淘汰。每次工具执行完成后重新预算，避免多轮工具结果使后续模型调用超限。

## 2 范围

本次实现覆盖直接对话 Agent 的模型上下文。完整会话的分页、归属校验、用户消息先落库和完整助手消息结束后落库沿用 `ChatSessionsService`。工作流节点继续使用自身的节点输入约束，后续可复用同一个预算器。

不在本次范围内：调用额外模型生成长期摘要、按不同供应商接入精确 tokenizer、修改前端历史分页协议。

## 3 数据保存与读取

`chat_sessions` 保存会话生命周期；`chat_session_messages` 保存完整正文、内容片段和 metadata。页面历史通过游标分页读取，不受模型上下文预算影响。

模型调用链为：

```text
ChatService
  -> ChatSessionsService.buildModelHistory 读取最近 historyTurns 轮
  -> AgentRuntimeService 执行检索和工具选择
  -> buildBudgetedModelContext 执行第二级和第三级裁剪
  -> ModelProvidersService.streamChatCompletion
  -> 工具执行后 rebudgetModelMessages 再次裁剪
  -> 完整结束后 ChatSessionsService.appendMessage 保存助手消息
```

失败或取消时保留已经写入的用户问题，不把半截助手输出伪装成完整回答。

## 4 总 Token 预算

当前默认模型上下文窗口为 32768 Token，默认预留输出 4096 Token；Agent 设置了 `maxTokens` 时以该值作为输出预留，并将异常的大值限制为 30720，保证至少留出 2048 Token 输入空间。模型请求使用同一个有效输出上限。输入预算计算为：

```text
input_budget = max(2048, context_window - output_reserve)
```

在尚未为每个模型维护 context window 元数据前，32768 是保守的统一默认值。后续应把模型配置的上下文窗口传给预算器，不需要改变裁剪算法。

Token 估算采用确定性保守算法：ASCII 约四字符一个 Token，非 ASCII 字符按一个 Token 计，并为每条消息和工具调用结构增加固定开销。它不依赖供应商 SDK，适合在模型网关前统一执行；接入精确 tokenizer 后可以替换估算函数。

## 5 三级裁剪规则

### 5.1 第一级 最近消息窗口

`ChatSessionsService.buildModelHistory` 只按 `(created_at, id)` 倒序读取最近 `historyTurns * 2` 条，再恢复为正序。完整历史仍保留在数据库。临时会话和外部会话进入 Runtime 前也经过同一轮数策略。

### 5.2 第二级 单条消息裁剪

每条候选消息单独限制大小。系统提示词和当前输入默认最多 8192 Token，历史、RAG 和 Tool Result 默认最多 4096 Token。超长字符串保留前部并追加明确裁剪标记。该操作只创建新的消息对象，不修改请求原文或数据库记录。

### 5.3 第三级 总预算裁剪

所有候选内容进入同一个预算池，不为 RAG 或历史建立互相隔离的额度。超限时按以下排序删除：

| 内容 | 默认优先级 | 删除依据 |
| --- | ---: | --- |
| 当前用户输入 | 110 | 必需，不整条删除；极端情况下缩短 |
| 系统提示词和 Skill Tool 规则 | 100 | 必需，不整条删除；极端情况下缩短 |
| 当前轮 Tool 调用与结果 | 70 | 优先保留较新的完整工具交互 |
| RAG 切片 | 55 | 先删除相关度分数较低的切片 |
| 历史 user assistant 消息 | 40 | 先删除较旧消息 |

排序键依次为：是否必需、业务优先级、相关度、序列位置。系统提示词和当前输入不会被整条移除；当仅两者仍超过预算时，两者共享剩余额度并分别裁剪。

工具回合需要保持供应商协议合法。实现必须把 assistant 的 `tool_calls` 与对应 tool result 视为同一交互组；删除时整组删除，不能产生孤立 Tool Result。

## 6 RAG 与 Tool Result

RAG 不再拼入一条不可拆分的巨大系统提示词。每个检索切片转换为独立 system 消息，携带文档名、chunk 序号和相关度，预算器可以先移除低相关切片。

Tool Result 在每轮执行后追加到运行时消息数组。下一次模型请求前调用 `rebudgetModelMessages`，与历史和 RAG 共用第二级、 第三级规则。完整工具输出仍由工具日志和本轮助手 metadata 保留，模型上下文中的裁剪不会影响审计记录。

## 7 可观测性与安全

预算器返回 `budgetTokens`、`estimatedTokens`、单条裁剪数和总预算删除数。下一步应把报告写入 Agent Run 的模型步骤，便于按模型、Agent 和请求 ID 排查上下文损失。

裁剪发生在敏感 Tool 参数脱敏之后。日志不得记录未脱敏凭据，也不得为了统计 Token 保存图片 data URL 或完整密钥字段。

## 8 测试与验收

自动测试覆盖：单条超长内容只裁剪副本、总预算优先删除旧历史、保留高相关 RAG 和 Tool Result、中英文 Token 估算。回归测试还应确认系统提示词不再内嵌 RAG 正文。

验收标准：

1. 数据库中已保存的完整消息不因模型预算改变。
2. 任一模型调用的估算输入不超过输入预算。
3. 单条消息、RAG 切片和 Tool Result 均可被裁剪。
4. 低相关、低优先级、较旧内容先被删除。
5. 工具回合新增结果后再次执行预算。
6. 当前输入和系统约束始终存在于最终模型上下文。
