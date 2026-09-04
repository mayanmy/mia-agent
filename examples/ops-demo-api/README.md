# Mia Ops Demo API

该服务为 Mia Workflow 求职演示提供稳定的模拟运维数据，不连接真实生产系统。
它使用 Node.js 22 内置 HTTP 能力，没有第三方运行时依赖。

## 启动

```bash
npm run dev:ops-demo
```

健康检查：

```bash
curl http://127.0.0.1:3100/health
```

## 模拟服务

| 服务名            | 场景                       |
| ----------------- | -------------------------- |
| `mia-api`         | PostgreSQL 连接池耗尽      |
| `mia-llm-gateway` | LLM Provider 首 Token 超时 |
| `mia-indexer`     | Embedding 429 导致索引失败 |
| `mia-web`         | 健康服务对照组             |

## HTTP 工具配置

Mia 后端与本服务同处 Docker Compose 网络时，Base URL 使用
`http://ops-demo-api:3100`，并开启“允许访问私网”。宿主机直接运行 Mia 后端时，
Base URL 使用 `http://127.0.0.1:3100`。

### 查询服务状态

- 方法：`GET`
- Path：`/api/services/health`
- Query 参数：`service_name`（文本、必填）、`environment`（文本、必填）

### 查询错误日志

- 方法：`POST`
- Path：`/api/logs/search`
- Body 参数：`service_name`（文本）、`environment`（文本）、
  `time_range_minutes`（数字）、`keywords`（数组），全部必填

### 创建故障工单

- 方法：`POST`
- Path：`/api/incidents`
- Body 参数：`service_name`、`environment`、`severity`、`summary`（文本），
  `diagnosis`（对象），全部必填；`sources`（数组）可选

为了便于验证，`GET /api/incidents` 可以查看当前进程中创建的工单。工单只保存在
内存中，服务重启后清空。

## 测试

```bash
npm run test:ops-demo
```
