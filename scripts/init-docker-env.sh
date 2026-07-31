#!/usr/bin/env bash

# 此文件只提供函数，由部署入口 source，不应作为独立部署脚本直接执行。
# 它统一保证前后端独立部署时使用同一套环境初始化规则。
init_docker_env() {
  local script_dir="$1"
  local env_file="${script_dir}/.env.docker"
  local env_example="${script_dir}/.env.docker.example"

  if [[ -f "${env_file}" ]]; then
    # 生产环境的密码和密钥必须长期稳定，因此已有配置绝不自动覆盖或轮换。
    return
  fi

  if ! command -v openssl >/dev/null 2>&1; then
    echo "错误：未找到 openssl，无法安全生成首次部署密钥。" >&2
    exit 1
  fi

  cp "${env_example}" "${env_file}"

  # 首次部署生成三组互相独立的随机值，分别用于数据库、敏感配置加密和 JWT 签名。
  local db_password
  local app_secret
  local jwt_secret
  db_password="$(openssl rand -hex 24)"
  app_secret="$(openssl rand -hex 32)"
  jwt_secret="$(openssl rand -hex 32)"

  sed -i.bak \
    -e "s/change-me-to-a-random-database-password/${db_password}/" \
    -e "s/change-me-to-a-long-random-secret/${app_secret}/" \
    -e "s/change-me-to-a-different-long-random-secret/${jwt_secret}/" \
    "${env_file}"
  rm -f "${env_file}.bak"
  # 环境文件包含生产密钥，仅允许当前系统用户读写。
  chmod 600 "${env_file}"
  echo "已创建 ${env_file}，请按部署环境修改地址、域名和端口。"
}
