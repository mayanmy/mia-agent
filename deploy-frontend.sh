#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/scripts/init-docker-env.sh"
init_docker_env "${SCRIPT_DIR}"
cd "${SCRIPT_DIR}"

if ! docker compose version >/dev/null 2>&1; then
  echo "错误：未找到 Docker Compose 插件。" >&2
  exit 1
fi

docker compose -p mia-frontend --env-file .env.docker -f docker-compose.frontend.yml up -d --build --remove-orphans
docker compose -p mia-frontend --env-file .env.docker -f docker-compose.frontend.yml ps

HTTP_PORT="$(sed -n 's/^MIA_HTTP_PORT=//p' .env.docker | tail -n 1)"
echo "Mia 前端已启动：http://localhost:${HTTP_PORT:-8080}"
