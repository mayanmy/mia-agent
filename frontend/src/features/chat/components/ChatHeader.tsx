import { Button, Tag } from "antd";

import type { AgentListItem } from "../../agents/api";
import { WorkspacePageHeader } from "../../../shared/components/WorkspacePageHeader";

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
  /** 详情页当前选中的 Agent。 */
  agent: AgentListItem | null;
};

/** 使用统一页面骨架展示 Chat 工作室或 Agent 对话详情。 */
export function ChatHeader({
  loadingAgents,
  onRefreshAgents,
  detail,
  onBack,
  agent
}: ChatHeaderProps) {
  return (
    <WorkspacePageHeader
      actions={!detail ? (
        <Button disabled={loadingAgents} onClick={onRefreshAgents}>
          刷新 Agent
        </Button>
      ) : undefined}
      backLabel="返回 Agent 列表"
      description={
        detail && agent ? `${agent.providerName} / ${agent.modelName}` : "选择一个 Agent 开始对话。"
      }
      eyebrow={detail ? "对话" : undefined}
      meta={
        detail && agent ? (
          <Tag color={agent.chatSessionMode === "PERSISTENT" ? "blue" : "default"}>
            {agent.chatSessionMode === "PERSISTENT" ? "保留会话" : "单次会话"}
          </Tag>
        ) : undefined
      }
      title={detail ? agent?.name || "测试对话" : "对话工作室"}
      onBack={detail ? onBack : undefined}
    />
  );
}
