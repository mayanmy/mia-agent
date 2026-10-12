# Mia 生产环境部署脚本清单

本文用于生产服务器日常发布和维护。默认项目目录为 `/www/wwwroot/mia`；如果实际路径不同，请先切换到对应目录。

## 1. 脚本职责

| 脚本 | 使用场景 | 主要行为 | 数据影响 |
| --- | --- | --- | --- |
| `deploy.sh` | 当前后端发布统一入口 | 仅调用 `deploy-backend.sh`：构建后端、启动数据库、执行迁移并更新 API | 保留数据库和知识库命名卷 |
| `deploy-backend.sh` | 只更新后端、数据库迁移或后端配置 | 构建后端镜像，启动 PostgreSQL，执行 Prisma migration，重建 API 容器 | 复用 `mia-backend_mia_postgres_data` 和 `mia-backend_mia_knowledge_data` |
| `deploy-frontend.sh` | 只更新 React 页面、Nginx 配置或前端代理地址 | 构建前端镜像，重建 Web/Nginx 容器 | 不访问 PostgreSQL |
| `scripts/init-docker-env.sh` | 被上述部署脚本自动调用 | 首次创建 `.env.docker` 并生成随机密钥 | 已存在的 `.env.docker` 不会被覆盖 |

辅助配置：

- `docker-compose.backend.yml`：PostgreSQL、数据库迁移和 API。
- `docker-compose.frontend.yml`：React 静态文件和容器内 Nginx。
- `.env.docker`：生产端口、域名、数据库密码及应用密钥，不得提交到 Git。

## 2. 首次部署

```bash
cd /www/wwwroot/mia
chmod +x deploy.sh deploy-backend.sh deploy-frontend.sh

# 第一次运行会生成 .env.docker；后端可能暂时按模板地址启动。
./deploy-backend.sh

# 修改正式域名、监听地址和 HTTPS Cookie 设置，并保留自动生成的密钥。
vim .env.docker

# 让正式配置生效，然后部署前端。
./deploy-backend.sh
./deploy-frontend.sh
```

生产 HTTPS 环境至少确认：

```dotenv
MIA_API_BIND_ADDRESS=127.0.0.1
MIA_WEB_BIND_ADDRESS=127.0.0.1
MIA_PUBLIC_BASE_URL=https://mia.example.com
MIA_CORS_ORIGINS=https://mia.example.com
MIA_AUTH_COOKIE_SECURE=true
MIA_API_UPSTREAM=http://host.docker.internal:8000
```

不要在已有环境中随意修改：

- `POSTGRES_PASSWORD`：修改后可能导致应用无法连接原数据库。
- `MIA_SECRET_KEY`：修改后已保存的模型 API Key 将无法解密。
- `MIA_AUTH_JWT_SECRET`：修改后现有登录令牌全部失效。

## 3. 日常发布

发布后端（`deploy.sh` 当前只部署后端）：

```bash
cd /www/wwwroot/mia
git pull
./deploy.sh
```

如本次同时包含前端变更，后端成功后还必须显式执行：

```bash
./deploy-frontend.sh
```

仅发布后端：

```bash
cd /www/wwwroot/mia
git pull
./deploy-backend.sh
```

仅发布前端：

```bash
cd /www/wwwroot/mia
git pull
./deploy-frontend.sh
```

后端发布会自动执行 `prisma migrate deploy`。涉及数据库迁移的版本必须先完成备份，并在低峰期发布。

## 4. 发布后检查

```bash
# 检查容器状态。
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml ps
docker compose -p mia-frontend --env-file .env.docker -f docker-compose.frontend.yml ps

# 检查服务器本机的 API 和前端健康端点。
curl -fsS http://127.0.0.1:8000/api/v1/health
curl -fsS http://127.0.0.1:8080/healthz

# 检查正式域名以及经过反向代理的 API。
curl -I https://mia.example.com/
curl -fsS https://mia.example.com/api/v1/health
```

还应在浏览器中登录并发送一条测试消息，确认 SSE 内容逐步返回，而不是等待完成后一次性出现。

## 5. 日志排查

```bash
# API 实时日志。
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml logs -f api

# 数据库迁移日志；后端容器未启动时优先查看此项。
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml logs migrate

# PostgreSQL 日志。
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml logs -f postgres

# 前端和容器内 Nginx 日志。
docker compose -p mia-frontend --env-file .env.docker -f docker-compose.frontend.yml logs -f web
```

## 6. 停止与重新启动

停止容器但保留数据：

```bash
docker compose -p mia-frontend --env-file .env.docker -f docker-compose.frontend.yml down
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml down
```

恢复服务直接执行：

```bash
./deploy.sh
./deploy-frontend.sh
```

第一条恢复后端，第二条恢复前端；`deploy.sh` 不会自动启动或更新前端。

`down` 不会删除命名卷。生产环境禁止追加 `--volumes` 或 `-v`。

## 7. 生产数据备份

一次完整备份必须包含：PostgreSQL、知识库文件和 `.env.docker`。备份目录应位于独立磁盘，并进一步复制到其他服务器或对象存储。

```bash
cd /www/wwwroot/mia
mkdir -p /www/backup/mia

# PostgreSQL 逻辑备份；custom 格式便于使用 pg_restore 恢复。
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml \
  exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "/www/backup/mia/mia-$(date +%F-%H%M%S).dump"

# 备份知识库上传文件。只读挂载数据卷，避免备份过程修改源文件。
docker run --rm \
  -v mia-backend_mia_knowledge_data:/source:ro \
  -v /www/backup/mia:/backup \
  alpine tar -czf "/backup/mia-knowledge-$(date +%F-%H%M%S).tar.gz" -C /source .

# 备份环境变量和密钥，并限制文件权限。
cp .env.docker "/www/backup/mia/env-$(date +%F-%H%M%S).docker"
chmod 600 /www/backup/mia/env-*.docker
```

备份完成后检查文件不为空：

```bash
ls -lh /www/backup/mia
```

## 8. 恢复操作边界

恢复会覆盖或合并生产数据，不能作为日常部署步骤。恢复前必须：

1. 停止业务写入并记录当前版本。
2. 再做一次当前数据库和知识库备份。
3. 确认备份文件、目标数据库和目标 Docker volume 名称。
4. 在测试环境演练 `pg_restore` 和文件恢复。
5. 制定失败后的回滚路径，再在生产执行。

不要直接复制 PostgreSQL 的 `/var/lib/postgresql/data` 目录来代替逻辑备份，也不要在 PostgreSQL 运行时修改其 volume 内容。

## 9. 禁止用于日常维护的命令

以下命令可能永久删除聊天记录、用户、Agent、模型配置和知识库文件：

```bash
docker compose down --volumes
docker compose down -v
docker volume prune
docker system prune --volumes
npx prisma migrate reset
npx prisma db push --force-reset
```

如确需清理废弃资源，必须先执行只读检查、确认精确目标并完成可恢复备份。

## 10. 推荐发布顺序

1. 阅读版本变更，确认是否包含数据库 migration。
2. 数据库变更前备份 PostgreSQL、知识库 volume 和 `.env.docker`。
3. 拉取代码并执行对应部署脚本。
4. 检查 Compose 状态和 migration 日志。
5. 检查本机及正式域名健康端点。
6. 登录页面验证鉴权、聊天 SSE、历史会话和知识库文件。
7. 观察 API 错误日志一段时间后结束发布。
