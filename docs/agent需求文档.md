Agent 页面现在有基础 CRUD 和模型选择，但离“能真正创建可用 Agent”还差这些：
必须补
默认模型接入：新增 Agent 时自动带出默认 Chat 模型，减少每次手选。
真实对话入口：Agent 保存后应该能“测试对话”或进入 Chat 页面，否则 Agent 只是配置。
工具绑定真实数据源：现在工具绑定还是前端 checkbox 区域/占位逻辑，后端有 agent_tools，但还没有 Tools 模块的真实工具列表。
状态与校验：保存前校验模型必须是启用的 Chat 模型；System Prompt 不能为空；temperature、max_tokens、上下文轮数边界提示更友好。
详情加载完整化：编辑时需要完整回显 toolIds、模型、generation params 等，避免更新时丢配置。
应该做
列表筛选/搜索：按名称、启用状态、模型供应商过滤。
复制 Agent：内部平台很常用，复制后改 Prompt 比从零创建快。
启用/停用快捷操作：列表上直接切换 enabled，不必打开编辑弹窗。
删除关联检查：如果 Agent 已经有会话/日志，删除应改为软删除或提示影响范围。
Prompt 编辑体验：System Prompt 至少支持更高 textarea、保存前预览/格式保持。
模型参数展示一致：列表现在展示 temperature，但 max_tokens、上下文轮数等关键参数可以在详情/编辑中更清晰。
后置
Agent 发布/分享入口
版本管理
Prompt 模板
Agent 运行统计
权限控制
知识库绑定
下一步我建议先做：默认模型接入 + Agent 测试对话入口。这两个做完，Agent 页面就从“配置管理”进入“可验证可使用”的阶段。
No newline at end of file
