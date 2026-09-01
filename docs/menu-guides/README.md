# Mia 菜单新手引导总目录

本目录按 Mia 左侧菜单拆分。建议第一次使用时按下表顺序阅读。

| 顺序 | 菜单 | 文档 | 谁能使用 | 主要目标 |
| --- | --- | --- | --- | --- |
| 1 | 模型供应商 | [模型供应商新手引导](./01-model-providers.md) | Admin / User | 配置 Chat 与 Embedding 模型 |
| 2 | 知识库 | [知识库新手引导](./03-knowledge.md) | Admin / User | 上传资料并完成向量索引 |
| 3 | 工具 | [工具新手引导](./04-tools.md) | Admin | 创建受控 HTTP API 工具 |
| 4 | MCP | [MCP 新手引导](./05-mcp.md) | Admin | 接入 MCP Server 并同步远程工具 |
| 5 | Skill | [Skill 新手引导](./06-skills.md) | Admin | 创建可复用专业指令 |
| 6 | Workflow | [Workflow 新手引导](./07-workflows.md) | Admin | 编排、校验并发布确定性流程 |
| 7 | Agent | [Agent 新手引导](./02-agents.md) | Admin / User | 组合模型、知识库、工具与 Workflow |
| 8 | Workflow 应用 | [Workflow 应用新手引导](./08-workflow-apps.md) | Admin / User | 运行已发布流程 |
| 9 | 对话 | [对话新手引导](./09-chat.md) | Admin / User | 使用 Agent、管理会话与附件 |
| 10 | 日志 | [日志新手引导](./10-logs.md) | Admin / User | 排查工具选择与执行错误 |
| 11 | Run Trace | [Run Trace 新手引导](./11-run-trace.md) | Admin | 排查一次 Agent 运行的完整阶段 |
| 12 | 成员 | [成员管理新手引导](./12-users.md) | Admin | 创建、邀请和治理账号 |

## 三个容易混淆的概念

- **Skill**：一组可复用文字指令，不会自动获得知识库或工具权限。
- **工具 / MCP**：让模型访问外部能力。工具是 Mia 管理员配置的固定 HTTP API；MCP 是从可信 MCP Server 动态发现工具、资源和 Prompt。
- **Workflow / Workflow 应用**：Workflow 是管理员的编排工作室；Workflow 应用是成员运行已发布版本的入口。

完整的端到端案例见 [Mia 新手引导：从零搭建私有知识库问答 Agent](../mia-beginner-guide.md)。

⚠️ 页面按钮以当前 Mia v0.1 代码为准。只有在理解影响后再执行删除、归档、取消发布、撤销授权、撤销会话或轮换 Token。
