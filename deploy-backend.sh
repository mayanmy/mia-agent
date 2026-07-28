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

docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml up -d --build --remove-orphans
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml ps
echo "Mia 后端已启动。"
