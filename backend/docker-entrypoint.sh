#!/bin/sh
set -eu

# Docker 命名卷会覆盖镜像内目录并可能恢复为 root 所有；启动时只修正卷根目录，
# 随后立即降权运行 API，避免知识库首次上传因无法创建子目录而返回 500。
chown node:node /app/storage/knowledge

exec gosu node "$@"
