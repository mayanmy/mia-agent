#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# 同机部署的统一入口：先部署数据库、迁移和 API，成功后再部署前端。
# set -e 会在后端部署失败时立即退出，避免前端已经更新而 API 仍停留在旧版本。
# 前后端分服务器部署时不要运行本脚本，应分别执行两个子脚本。
"${SCRIPT_DIR}/deploy-backend.sh"
"${SCRIPT_DIR}/deploy-frontend.sh"
