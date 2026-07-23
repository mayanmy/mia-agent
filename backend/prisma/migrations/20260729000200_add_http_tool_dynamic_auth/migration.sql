-- 动态鉴权的非敏感请求/响应映射放在工具配置中；客户端密钥仍存入加密的 tool_secrets。
ALTER TABLE "http_tools"
ADD COLUMN "auth_config" JSONB NOT NULL DEFAULT '{}'::jsonb;
