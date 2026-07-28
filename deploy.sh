#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# 同机部署保留一个入口；两个子脚本也可在不同服务器上分别执行。
"${SCRIPT_DIR}/deploy-backend.sh"
"${SCRIPT_DIR}/deploy-frontend.sh"
