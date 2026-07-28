#!/usr/bin/env bash

# 此文件由部署入口 source，统一保证前后端独立部署时使用同一套初始化规则。
init_docker_env() {
  local script_dir="$1"
  local env_file="${script_dir}/.env.docker"
  local env_example="${script_dir}/.env.docker.example"

  if [[ -f "${env_file}" ]]; then
    return
  fi

  if ! command -v openssl >/dev/null 2>&1; then
    echo "错误：未找到 openssl，无法安全生成首次部署密钥。" >&2
    exit 1
  fi

  cp "${env_example}" "${env_file}"

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
  chmod 600 "${env_file}"
  echo "已创建 ${env_file}，请按部署环境修改地址、域名和端口。"
}
