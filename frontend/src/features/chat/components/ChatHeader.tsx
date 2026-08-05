import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Space } from "antd";

/** Chat 页面标题栏参数。 */
type ChatHeaderProps = {
  /** Agent 列表是否正在刷新。 */
  loadingAgents: boolean;
  /** 手动刷新 Agent 列表回调。 */
  onRefreshAgents: () => void;
  /** 当前是否已进入某个 Agent 的聊天详情。 */
  detail: boolean;
  /** 返回 Agent 卡片列表。 */
  onBack: () => void;
};

/** 展示 Chat 测试页说明与 Agent 刷新入口。 */
export function ChatHeader({ loadingAgents, onRefreshAgents, detail, onBack }: ChatHeaderProps) {
  return (
    <header className="compactPageHeader">
      <div>
        <h1>{detail ? "测试对话" : "对话工作室"}</h1>
        <p>{detail ? "验证 Prompt、工具调用和模型回复效果。" : "选择一个 Agent 开始对话。"}</p>
      </div>
      <Space>
        {detail ? (
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
            返回 Agent 列表
          </Button>
        ) : null}
        <Button disabled={loadingAgents} onClick={onRefreshAgents}>
          刷新 Agent
        </Button>
      </Space>
    </header>
  );
}
