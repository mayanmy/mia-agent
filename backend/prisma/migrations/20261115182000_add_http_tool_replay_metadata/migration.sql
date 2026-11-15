ALTER TABLE "http_tools"
ADD COLUMN "side_effect_level" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "replay_policy" TEXT NOT NULL DEFAULT 'FORBIDDEN',
ADD COLUMN "idempotency_supported" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "idempotency_transport" TEXT,
ADD COLUMN "idempotency_field_name" TEXT,
ADD COLUMN "result_lookup_supported" BOOLEAN NOT NULL DEFAULT false;

-- 只读 GET 可以安全重新读取；POST 保持 UNKNOWN/FORBIDDEN，必须由管理员显式声明。
UPDATE "http_tools"
SET "side_effect_level" = 'READ', "replay_policy" = 'REEXECUTE'
WHERE "method" = 'GET';

ALTER TABLE "http_tools"
ADD CONSTRAINT "chk_http_tools_side_effect_level"
CHECK ("side_effect_level" IN ('NONE', 'READ', 'IDEMPOTENT_WRITE', 'NON_IDEMPOTENT_WRITE', 'UNKNOWN')),
ADD CONSTRAINT "chk_http_tools_replay_policy"
CHECK ("replay_policy" IN ('REUSE', 'REEXECUTE', 'REQUIRE_CONFIRMATION', 'FORBIDDEN')),
ADD CONSTRAINT "chk_http_tools_idempotency_transport"
CHECK ("idempotency_transport" IS NULL OR "idempotency_transport" IN ('HEADER', 'BODY')),
ADD CONSTRAINT "chk_http_tools_idempotency_consistency"
CHECK (
  ("idempotency_supported" = false AND "idempotency_transport" IS NULL AND "idempotency_field_name" IS NULL AND "result_lookup_supported" = false)
  OR
  ("idempotency_supported" = true AND "side_effect_level" = 'IDEMPOTENT_WRITE' AND "idempotency_transport" IS NOT NULL AND "idempotency_field_name" IS NOT NULL)
);
