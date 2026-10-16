# MCP 菜单新手引导

## 一、这个页面做什么

MCP 页面连接可信的 Streamable HTTP MCP Server，发现其工具、资源和 Prompt，并治理哪些远程工具可供 Agent 使用。

## 二、工具与 MCP 的区别

- “工具”页面：管理员手工定义一个固定 HTTP API。
- “MCP”页面：连接遵循 MCP 协议的服务端，动态同步工具/资源/Prompt 目录。

## 三、页面按钮

| 按钮/图标           | 作用                           |
| ------------------- | ------------------------------ |
| 刷新                | 更新 Server 列表               |
| 新增 Server         | 打开 MCP Server 表单           |
| OAuth 授权/重新授权 | 完成 Authorization Code + PKCE |
| 撤销 OAuth 授权     | 让既有授权立即失效             |
| 测试连接            | 检查 Endpoint、鉴权和协议握手  |
| 同步工具            | 重新发现远程工具目录           |
| 工具目录            | 查看并启停单个远程工具         |
| 资源目录            | 查看 MCP Resources             |
| Prompt 目录         | 查看 MCP Prompts               |
| 编辑                | 修改连接、安全策略和限额       |
| 删除                | 删除 Server 与本地目录快照     |

## 四、创建一个 MCP Server

### 操作步骤

1. 点击“新增 Server”。
2. 填写名称、Slug、描述和 Streamable HTTP Endpoint。
3. 选择鉴权方式。
4. 设置“启用 Server”“允许私网访问”“默认执行策略”。
5. 保持合理的超时、并发和响应上限，点击“创建”。
6. 点击“测试连接”。
7. 成功后点击“同步工具”，再打开“工具目录”启用需要的工具。

### 公网 Bearer 示例

```text
名称：内部工单 MCP
Slug：internal-tickets
Endpoint：https://mcp.example.com/mcp
鉴权方式：Bearer Token
Bearer Token：替换为真实凭据
启用 Server：开
允许私网访问：关
默认执行策略：自动执行
连接超时：10000 ms
工具超时：60000 ms
并发数：3
```

### 效果预期

健康状态变为可用，最近同步时间更新，工具列显示“已启用数 / 总数”。

## 五、鉴权怎么选

- **无鉴权**：仅适合可信、隔离的服务。
- **Bearer Token / API Key Header**：最简单的服务间鉴权。
- **Client Credentials**：机器身份；需 Token URL、Client ID/Secret。
- **OAuth Authorization Code + PKCE**：需要用户授权；创建后点授权图标完成浏览器流程。

## 六、绑定到 Agent

1. 同步工具并在工具目录启用目标工具。
2. 编辑 Agent →“工具绑定”。
3. 在“MCP 工具”分组勾选并保存。
4. 用明确参数测试，并到日志查看远程执行结果。

## 七、常见问题

- **公网 HTTP 被拒**：公网 Endpoint 必须 HTTPS。
- **内网地址被拒**：仅对可信内网 Server 打开“允许私网访问”。
- **测试成功但工具为空**：点“同步工具”，并确认 Server 实现 tools/list。
- **OAuth 未授权**：完成授权图标流程；过期后重新授权。
- **工具不可选**：工具目录中未启用，或默认执行策略为“禁止执行”。
- **响应过大/超时**：调高上限前先确认远端是否返回了异常大数据。

⚠️ MCP Server 能代表 Mia 访问远端能力。只接入可信服务；“允许私网访问”会扩大 SSRF 风险面，不要对未知 Server 开启。
