import { Button, Space } from "antd";

/** Chat 页面标题栏参数。 */
type ChatHeaderProps = {
  /** Agent 列表是否正在刷新。 */
  loadingAgents: boolean;
  /** 手动刷新 Agent 列表回调。 */
  onRefreshAgents: () => void;
};

/** 展示 Chat 测试页说明与 Agent 刷新入口。 */
export function ChatHeader({
  loadingAgents,
  onRefreshAgents
}: ChatHeaderProps) {
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
