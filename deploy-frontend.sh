#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# 前后端独立部署时也复用同一份环境初始化逻辑；已有 .env.docker 不会被覆盖。
source "${SCRIPT_DIR}/scripts/init-docker-env.sh"
init_docker_env "${SCRIPT_DIR}"
cd "${SCRIPT_DIR}"

if ! docker compose version >/dev/null 2>&1; then
  echo "错误：未找到 Docker Compose 插件。" >&2
  exit 1
fi

# 固定项目名 mia-frontend，重建 React 静态资源镜像和容器内 Nginx。
# MIA_API_UPSTREAM 在镜像运行时注入，用于把 /api 请求代理到后端。
docker compose -p mia-frontend --env-file .env.docker -f docker-compose.frontend.yml up -d --build --remove-orphans

# 输出 Web 容器和健康检查状态。
docker compose -p mia-frontend --env-file .env.docker -f docker-compose.frontend.yml ps

# 仅用于打印本机访问地址；生产环境对外地址以 MIA_PUBLIC_BASE_URL/反向代理域名为准。
HTTP_PORT="$(sed -n 's/^MIA_HTTP_PORT=//p' .env.docker | tail -n 1)"
echo "Mia 前端已启动：http://localhost:${HTTP_PORT:-8080}"
