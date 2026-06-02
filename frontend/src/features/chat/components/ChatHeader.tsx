import { Button, Space } from "antd";

export function ChatHeader({
  loadingAgents,
  onRefreshAgents
}: {
  loadingAgents: boolean;
  onRefreshAgents: () => void;
}) {
  return (
    <header className="pageHeader">
      <div>
        <p className="eyebrow">Chat</p>
        <h1>测试对话</h1>
      </div>
      <Space>
        <Button disabled={loadingAgents} onClick={onRefreshAgents}>
          刷新 Agent
        </Button>
      </Space>
    </header>
  );
}
