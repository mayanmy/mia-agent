-- 对已有 Agent 使用单次会话作为默认值，避免升级后意外开始保存历史消息。
CREATE TYPE "agent_chat_session_mode" AS ENUM ('EPHEMERAL', 'PERSISTENT');

ALTER TABLE "agents"
  ADD COLUMN "chat_session_mode" "agent_chat_session_mode" NOT NULL DEFAULT 'EPHEMERAL';
