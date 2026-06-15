import { Button, Space } from "antd";

export function ChatHeader({
  loadingAgents,
  onRefreshAgents
}: {
  loadingAgents: boolean;
  onRefreshAgents: () => void;
}) {
  return (
    <header className="compactPageHeader">
      <div>
        <h1>测试对话</h1>
        <p>选择 Agent 后验证 Prompt、工具调用和模型回复效果。</p>
      </div>
      <Space>
        <Button disabled={loadingAgents} onClick={onRefreshAgents}>
          刷新 Agent
        </Button>
      </Space>
    </header>
  );
}
