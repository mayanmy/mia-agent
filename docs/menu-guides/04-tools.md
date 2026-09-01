# 工具菜单新手引导

## 一、这个页面做什么

“工具”用于配置受控 HTTP API。管理员固定地址、鉴权和网络策略，模型只填写声明过的业务参数。

## 二、页面按钮

| 按钮 | 作用 |
| --- | --- |
| 刷新 | 重新加载工具列表 |
| 新增 HTTP 工具 | 创建 GET/POST API 工具 |
| 测试 | 输入业务参数 JSON 并真实执行一次 |
| 编辑 | 修改工具和凭据；编辑时凭据留空可保留旧值 |
| 删除 | 删除工具；先解除 Agent/Workflow 引用 |
| 添加参数 | 声明 path/query/header/body 参数 |
| 添加 Header | 配置固定 HTTP Header |
| 执行测试 | 调用接口并显示结果或错误 |

## 三、创建查询假期余额工具

### 操作步骤

1. 点击“新增 HTTP 工具”。
2. 填写名称、标识、描述、方法、Base URL 和 Path。
3. 添加 `employeeId` path 参数和 `year` query 参数。
4. 选择鉴权并填凭据。
5. 保持启用，点击“创建”。

### 可复制示例

```text
名称：查询假期余额
标识：query_leave_balance
描述：用户询问剩余年假时调用，必须提供 employeeId 和 year
方法：GET
Base URL：https://hr-api.example.com
Path：/api/leave-balance/{employeeId}
鉴权：Bearer Token
```

参数：

```json
[
  {"name":"employeeId","targetName":"employeeId","type":"string","location":"path","required":true,"sensitive":false},
  {"name":"year","targetName":"year","type":"number","location":"query","required":true,"sensitive":false}
]
```

## 四、测试和绑定

1. 列表点击“测试”。
2. 输入：

   ```json
   {"employeeId":"E1001","year":2026}
   ```

3. 点击“执行测试”，预期显示接口 JSON。
4. 编辑 Agent →“工具绑定”→勾选该工具→保存。
5. 提问：

   ```text
   请调用查询假期余额工具，查询 E1001 在 2026 年的余额，不要猜测。
   ```

## 五、字段解释

- **标识**：小写字母开头，只能用小写字母、数字、下划线。
- **targetName**：实际 HTTP 字段名；不填时通常与业务参数名一致。
- **location**：path 替换 `{变量}`；query 拼 URL；header 写请求头；body 仅 POST 可用。
- **敏感**：日志显示时脱敏，适合身份证、手机号等参数。
- **固定 Headers**：由管理员固定，模型不能改。

## 六、常见问题

- **Path 未替换**：占位符和 path 参数的 targetName 不一致。
- **参数校验失败**：JSON 类型与声明不一致，如 year 写成字符串。
- **401**：鉴权类型、Header 名或凭据错误。
- **访问 localhost/内网被拒**：配置 `TOOLS_HTTP_ALLOWED_HOSTS`；仅可信开发环境开启 localhost。
- **Agent 不调用**：工具描述不清楚、未绑定、模型不支持或问题缺少必填参数。

⚠️ HTTP 工具可能执行真实写操作。新手先从只读 GET 开始；不要把删除、付款等高风险接口设置成可以被模型无条件调用。
