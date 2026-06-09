# 前端SSE方案对比

> fetch + ReadableStream 读取 SSE。对比浏览器原生 EventSource，核心差异是：EventSource 简单但限制多，fetch stream 更灵活但要自己处理细节。

| 维度            | 当前 `fetch + ReadableStream`                                     | `EventSource`                          |
| --------------- | ----------------------------------------------------------------- | -------------------------------------- |
| 请求方法        | 支持 `POST`                                                       | 只支持 `GET`                           |
| 请求体          | 支持 JSON body，适合传 `agentId`、message、history、images、files | 不支持 body，只能拼 query              |
| 自定义 Header   | 支持                                                              | 原生不方便设置自定义 header            |
| 图片/文件       | 可以直接随请求 body 发送                                          | 不适合，URL/query 容量和安全性都不合适 |
| 取消请求        | `AbortController` 很自然                                          | 通过 `eventSource.close()`             |
| 错误处理        | 要自己判断 HTTP status、解析错误                                  | HTTP 错误信息拿得不完整                |
| 事件解析        | 要自己按 `\n\n` 拆 SSE                                            | 浏览器自动解析                         |
| 自动重连        | 需要自己实现                                                      | 原生支持自动重连                       |
| 心跳处理        | 自己处理 `ping` 事件                                              | 原生也能处理自定义事件                 |
| 兼容性          | 现代浏览器没问题                                                  | 兼容性很好                             |
| 代码复杂度      | 较高                                                              | 较低                                   |
| 后端实现        | 仍然是 `text/event-stream`                                        | 标准 SSE                               |
| 代理兼容        | 类似，都要关闭 buffering                                          | 类似                                   |
| 流式 token 控制 | 灵活                                                              | 简单够用                               |
| 适合 Mia 吗     | 更适合                                                            | 不太适合当前需求                       |

## 为什么 Mia 当前更适合 fetch + ReadableStream

Mia 的 Chat 请求不是一个简单的“订阅流”，而是一次复杂的对话请求，需要传：

```
agentId
message
history
images
files
```

这些数据天然适合放在 POST JSON body 里。尤其是图片、文件、历史消息，如果用 EventSource，只能塞进 query 参数或先创建一个会话请求再用 GET 订阅，流程会变复杂。

也就是说，EventSource 要做成这样：

```
POST /api/v1/chat/requests     创建对话请求
GET  /api/v1/chat/stream/:id   订阅流
```

而当前方案可以直接：

```
POST /api/v1/chat/stream       请求 + 流式返回一次完成
```

## 当前方案的缺点

### 当前实现需要自己处理这些事情：

- SSE 文本解析
- event: / data: 拆分
- 半包 buffer
- 错误事件
- 请求取消
- 重连策略
- 浏览器刷新或网络中断后的恢复
  其中最明显的短板是：没有自动重连。不过对 Chat 生成来说，这反而不是大问题，因为 LLM 流式输出一旦中断，自动重连也很难从断点继续生成，通常应该让用户重新发送或重新生成。

## EventSource 的优势

EventSource 更适合这些场景：

```
系统通知
任务进度
日志 tail
后台 job 状态
模型同步进度
知识库索引进度
```

这些场景通常是：

```
客户端订阅一个已有资源
服务端持续推送状态
GET 请求即可
可以断线重连
```

例如后续 Mia 做知识库文档索引进度，用 EventSource 就很合适：

```
GET /api/v1/jobs/{id}/events
```

## 结论

> Chat 流式对话继续用当前 fetch + ReadableStream 更合适。
> EventSource 可以留给后续这些模块：

```
知识库索引进度
模型同步进度
后台任务状态
系统通知
日志实时查看
```

> Chat 是一次带复杂请求体的生成任务，用 fetch stream；任务进度是订阅型推送，用 EventSource。

## websocket对比

> 对 Mia 现在的 Chat 场景，SSE 比 WebSocket 更合适。核心原因是：LLM 对话流大多数是“客户端发一次请求，服务端持续返回 token”，本质是单向流式输出，不是高频双向实时通信。
> | 维度 | SSE | WebSocket |
> | --- | --- | --- |
> | 通信方向 | 服务端 -> 客户端单向推送 | 双向通信 |
> | Chat 流式输出 | 很适合 | 也能做，但偏重 |
> | 请求模型 | HTTP 请求/响应语义清晰 | 长连接协议，需要自定义消息协议 |
> | 鉴权 | 复用 HTTP 鉴权、Cookie、Header | 需要额外处理连接鉴权和续期 |
> | 代理支持 | Nginx/Caddy/网关容易配置 | 需要处理 upgrade、连接保持 |
> | 调试 | curl、浏览器 Network 都好看 | 调试复杂一些 |
> | 错误处理 | HTTP status + SSE event | 要自己定义错误帧 |
> | 取消生成 | 关闭请求即可 | 要定义 cancel 消息 |
> | 服务端复杂度 | 低 | 更高 |
> | 扩容复杂度 | 相对简单 | 连接状态、粘性会话、广播更复杂 |
> | 适合场景 | LLM token 流、任务进度、日志流 | 协同编辑、多人实时、语音、双向控制 |

为什么 Chat 用 SSE
一次 Mia 对话大概是这样：

```
用户发送消息
-> 后端加载 Agent
-> 调用模型
-> 模型持续吐 token
-> 前端逐字显示
-> 结束
```

这个过程中，前端只需要在开始时发一次请求，后续主要是服务端往前端推 token。SSE 正好对应这个模型。
当前实现：

```
POST /api/v1/chat/stream
Content-Type: text/event-stream
```

前端用 fetch + ReadableStream 读：

```
message_start
token
token
token
message_end
```

这比 WebSocket 简单很多。

### 什么时候 WebSocket 更合适

如果以后 Mia 要做这些能力，WebSocket 会更值得考虑：

```
多人同时编辑 Agent / Prompt
多人共享同一个 Chat 会话
实时在线状态
语音实时对话
边说边打断
工具执行过程需要前端持续交互确认
一个连接里同时跑多个任务
```

这些是典型的双向实时场景。
比如：

```
用户说话音频流 -> 服务端
模型语音结果流 -> 用户
用户随时打断 -> 服务端
服务端状态更新 -> 用户
```

这种就更像 WebSocket。

### 为什么现在不优先 WebSocket

对 Mia v0.1 来说，WebSocket 会额外带来一批复杂度：

```
连接生命周期管理
连接鉴权
断线重连
消息协议设计
心跳保活
请求与响应配对
多 tab 连接管理
服务重启后的连接恢复
部署时处理 proxy upgrade
未来扩容时处理粘性会话或连接路由
```

而 SSE 只需要守住：

```
关闭代理缓冲
提高 read timeout
支持请求取消
定期 ping
```

就够用了。

### 结论

Mia 当前 Chat 选 SSE 是合理的：

```
LLM 流式输出：SSE
后台任务进度：SSE / EventSource
多人实时协作、语音、双向控制：WebSocket
```

> SSE 是“服务端持续说”，WebSocket 是“双方一直聊”；Mia 当前 Chat 主要是模型持续说，所以 SSE 更轻、更稳、更好维护。
