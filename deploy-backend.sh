#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# 首次部署时根据模板生成 .env.docker 和随机密钥；已有文件不会被覆盖。
source "${SCRIPT_DIR}/scripts/init-docker-env.sh"
init_docker_env "${SCRIPT_DIR}"
cd "${SCRIPT_DIR}"

if ! docker compose version >/dev/null 2>&1; then
  echo "错误：未找到 Docker Compose 插件。" >&2
  exit 1
fi

# 固定项目名 mia-backend，确保每次发布复用同一组容器和命名卷：
# - mia-backend_mia_postgres_data：PostgreSQL 数据（包括聊天记录）
# - mia-backend_mia_knowledge_data：知识库上传文件
# up --build 只会重建镜像和容器，不会删除命名卷；严禁在生产维护中追加 --volumes。
# migrate 服务会在 API 启动前执行 prisma migrate deploy，迁移失败时 API 不会启动。
# --remove-orphans 只移除不再属于当前 Compose 配置的容器，不删除上述命名卷。
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml up -d --build --remove-orphans

# 输出部署后的容器状态，便于确认 postgres、migrate 和 api 的启动结果。
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml ps
echo "Mia 后端已启动。"
