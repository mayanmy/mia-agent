# Mia 宝塔面板 Nginx 部署指南

本文适用于在一台安装了宝塔面板的 Linux 服务器上部署 Mia。推荐架构如下：

```text
浏览器
  -> 宝塔 Nginx（80/443、HTTPS）
    -> /api/*  -> Mia API 容器（127.0.0.1:8000）
    -> 其他请求 -> Mia Web 容器（127.0.0.1:8080）

Mia API 容器
  -> PostgreSQL + pgvector 容器
```

宝塔 Nginx 是唯一对公网开放的入口。Docker 中的前端和 API 端口只监听服务器回环地址，不应直接暴露到公网。

## 1. 准备条件

- 一台 Linux 服务器，建议至少 2 核 CPU、4 GB 内存。
- 已安装宝塔面板和宝塔 Nginx。
- 已安装 Docker Engine 及 Docker Compose 插件。
- 域名已解析到服务器公网 IP，例如 `mia.example.com`。
- 云厂商安全组和服务器防火墙仅需开放 `80`、`443` 和管理所需的 SSH/宝塔端口。

检查 Docker：

```bash
docker --version
docker compose version
```

## 2. 上传项目

建议将项目放在独立目录，例如：

```bash
mkdir -p /www/wwwroot/mia
cd /www/wwwroot/mia
```

通过 Git、宝塔文件管理器或其他发布流程将项目上传到该目录。不要把 `.env.docker` 提交到 Git。

部署脚本包括：

- `deploy-backend.sh`：部署 PostgreSQL、数据库迁移和 API。
- `deploy-frontend.sh`：部署 React 前端和容器内 Nginx。
- `deploy.sh`：当前只部署后端，等价于调用 `deploy-backend.sh`；不会部署前端。

## 3. 配置生产环境变量

首次可以让脚本自动生成环境文件：

```bash
chmod +x deploy.sh deploy-backend.sh deploy-frontend.sh
./deploy-backend.sh
```

脚本会根据 `.env.docker.example` 创建 `.env.docker`，并自动生成数据库密码、模型凭证加密密钥和 JWT 密钥。

随后编辑：

```bash
vim /www/wwwroot/mia/.env.docker
```

同机部署、域名为 `mia.example.com` 时，推荐配置：

```dotenv
MIA_HTTP_PORT=8080
MIA_WEB_BIND_ADDRESS=127.0.0.1

MIA_API_PORT=8000
MIA_API_BIND_ADDRESS=127.0.0.1

MIA_PUBLIC_BASE_URL=https://mia.example.com
MIA_CORS_ORIGINS=https://mia.example.com
MIA_AUTH_COOKIE_SECURE=true

# 前端容器自身的 API 代理备用地址。宝塔 Nginx 会直接把 /api/ 转发到 8000。
MIA_API_UPSTREAM=http://host.docker.internal:8000
```

保留脚本自动生成的以下值，不要再次修改或轮换：

```dotenv
POSTGRES_PASSWORD=自动生成的值
MIA_SECRET_KEY=自动生成的值
MIA_AUTH_JWT_SECRET=自动生成的值
```

注意：

- 修改 `MIA_SECRET_KEY` 会导致已经保存的模型 API Key 无法解密。
- 修改 `MIA_AUTH_JWT_SECRET` 会让现有登录令牌全部失效。
- HTTPS 域名必须设置 `MIA_AUTH_COOKIE_SECURE=true`。
- 多个允许访问的前端域名使用英文逗号分隔，不能填写 `*`。

保存配置后重新创建后端容器，使生产域名配置生效：

```bash
./deploy-backend.sh
```

## 4. 启动 Docker 服务

后端已在初始化环境变量时启动。继续启动前端：

```bash
cd /www/wwwroot/mia
./deploy-frontend.sh
```

也可以通过统一入口重新构建并启动后端（当前不会更新前端）：

```bash
./deploy.sh
```

如代码同时包含前端变更，随后必须单独执行：

```bash
./deploy-frontend.sh
```

检查状态：

```bash
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml ps
docker compose -p mia-frontend --env-file .env.docker -f docker-compose.frontend.yml ps
```

在服务器本机检查健康状态：

```bash
curl -fsS http://127.0.0.1:8000/api/v1/health
curl -fsS http://127.0.0.1:8080/healthz
```

两个请求都成功后再配置宝塔网站。

## 5. 在宝塔创建网站

1. 打开宝塔面板的“网站”。
2. 点击“添加站点”。
3. 域名填写 `mia.example.com`。
4. PHP 版本选择“纯静态”。
5. 数据库不创建。
6. 创建完成后进入该网站的“配置文件”。

网站根目录不会用于保存 Mia 文件，因为所有请求都会反向代理到 Docker 容器。

## 6. 宝塔 Nginx 完整配置

在网站配置中保留宝塔生成的 SSL 证书路径，将 `server` 内容调整为下面的结构。域名和证书路径需要替换为实际值。

```nginx
server {
    listen 80;
    server_name mia.example.com;

    # 宝塔申请证书后通常会自动生成 HTTPS 跳转，也可以使用这一段。
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name mia.example.com;

    # 使用宝塔面板生成的实际证书路径，不要照抄示例路径。
    ssl_certificate     /www/server/panel/vhost/cert/mia.example.com/fullchain.pem;
    ssl_certificate_key /www/server/panel/vhost/cert/mia.example.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 32m;

    # API 和 SSE 直接进入 NestJS，减少一层代理。
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;

        # SSE 必须关闭响应缓冲、缓存和压缩。
        proxy_buffering off;
        proxy_cache off;
        gzip off;
        add_header X-Accel-Buffering no always;

        # LLM 生成和工具调用可能持续数分钟。
        proxy_connect_timeout 10s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # React 页面、静态资源和 Agent Widget。
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    access_log /www/wwwlogs/mia.example.com.log;
    error_log  /www/wwwlogs/mia.example.com.error.log;
}
```

保存配置前，可以在服务器执行：

```bash
nginx -t
```

如果宝塔使用自己的 Nginx 路径，可在面板中点击“保存”，宝塔会自动检查配置。配置成功后重载 Nginx。

## 7. 申请并启用 HTTPS

1. 进入网站的“SSL”页面。
2. 使用 Let's Encrypt 申请证书。
3. 开启“强制 HTTPS”。
4. 确认 `.env.docker` 中已经设置：

```dotenv
MIA_PUBLIC_BASE_URL=https://mia.example.com
MIA_CORS_ORIGINS=https://mia.example.com
MIA_AUTH_COOKIE_SECURE=true
```

修改环境变量后重新创建 API 容器：

```bash
./deploy-backend.sh
```

## 8. 验证部署

浏览器检查：

```text
https://mia.example.com/
https://mia.example.com/api/v1/health
https://mia.example.com/mia-agent-widget.min.js
```

命令行检查：

```bash
curl -I https://mia.example.com/
curl -fsS https://mia.example.com/api/v1/health
curl -I https://mia.example.com/mia-agent-widget.min.js
```

进入对话页发送消息，确认响应内容是逐步出现的。如果等待很久后一次性出现，通常是某一层 Nginx 仍开启了代理缓冲。

## 9. 日志与常用维护命令

查看后端日志：

```bash
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml logs -f api
```

查看数据库迁移日志：

```bash
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml logs migrate
```

查看前端日志：

```bash
docker compose -p mia-frontend --env-file .env.docker -f docker-compose.frontend.yml logs -f web
```

重新部署后端：

```bash
cd /www/wwwroot/mia
./deploy.sh
```

如果本次也修改了前端，再执行 `./deploy-frontend.sh`。

如果只修改了 `.env.docker` 或只需要重启已有镜像，可以跳过镜像构建：

```bash
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml \
  up -d --no-build
```

后端 Dockerfile 会让迁移镜像与 API 镜像共享 OpenSSL 基础层，并为 apt、npm 下载启用
BuildKit 缓存。不要在宝塔定时任务中执行 `docker builder prune -a` 或
`docker system prune -a`，否则依赖会在下一次部署时重新下载。

停止服务但保留数据：

```bash
docker compose -p mia-frontend --env-file .env.docker -f docker-compose.frontend.yml down
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml down
```

不要在日常维护中添加 `--volumes`，否则会删除 PostgreSQL 和知识库文件的 Docker 数据卷。

## 10. 备份建议

需要同时备份三类数据：

1. PostgreSQL 数据库。
2. `mia-backend_mia_knowledge_data` Docker volume 中的上传文件。
3. 项目目录中的 `.env.docker`。

数据库逻辑备份示例：

```bash
mkdir -p /www/backup/mia
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml \
  exec -T postgres pg_dump -U mia -d mia -Fc > /www/backup/mia/mia-$(date +%F).dump
```

备份文件应复制到另一台服务器或对象存储，不能只保存在同一块磁盘。

## 11. 前后端分服务器部署

如果前端与后端位于不同服务器：

### 后端服务器

```dotenv
MIA_API_BIND_ADDRESS=0.0.0.0
MIA_API_PORT=8000
MIA_PUBLIC_BASE_URL=https://mia.example.com
MIA_CORS_ORIGINS=https://mia.example.com
MIA_AUTH_COOKIE_SECURE=true
```

建议不要直接向公网开放 `8000`。更安全的方式是在后端服务器也创建一个 HTTPS 网站，例如 `mia-api.example.com`，由宝塔 Nginx 代理到 `127.0.0.1:8000`，并只通过 HTTPS 提供 API。

### 前端服务器

```dotenv
MIA_WEB_BIND_ADDRESS=127.0.0.1
MIA_HTTP_PORT=8080
MIA_API_UPSTREAM=https://mia-api.example.com
```

前端域名的宝塔 Nginx 可以继续将 `/api/` 转发到前端容器，容器内 Nginx 再代理到 `MIA_API_UPSTREAM`；此时外层 `/api/` 位置仍必须关闭缓冲。若网络条件允许，也可以让宝塔 Nginx 直接代理到后端内网地址，以减少一层代理。

## 12. 常见问题

### 页面能打开，但 API 返回 502

先执行：

```bash
curl -v http://127.0.0.1:8000/api/v1/health
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml ps
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml logs api
```

重点检查 API 是否健康、端口是否监听 `127.0.0.1:8000`，以及数据库迁移是否成功。

### 登录成功后立即掉线

检查以下配置是否与浏览器实际访问地址一致：

```dotenv
MIA_PUBLIC_BASE_URL=https://mia.example.com
MIA_CORS_ORIGINS=https://mia.example.com
MIA_AUTH_COOKIE_SECURE=true
```

同时确认宝塔 Nginx 已传递 `X-Forwarded-Proto $scheme`。

### 对话不是流式输出

检查所有经过的 Nginx `location /api/` 是否包含：

```nginx
proxy_buffering off;
proxy_cache off;
gzip off;
proxy_read_timeout 300s;
add_header X-Accel-Buffering no always;
```

不要为 `text/event-stream` 开启响应压缩。

### 上传文档返回 413

确认宝塔网站配置和容器内 Nginx 都包含：

```nginx
client_max_body_size 32m;
```

修改后重新加载宝塔 Nginx。
