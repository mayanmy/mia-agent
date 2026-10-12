#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# 当前统一入口只部署数据库、迁移和 API。
# 前端发布必须显式执行 deploy-frontend.sh，避免后端发布意外覆盖前端版本。
"${SCRIPT_DIR}/deploy-backend.sh"
