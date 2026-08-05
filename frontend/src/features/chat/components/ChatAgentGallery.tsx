import { DatabaseOutlined, RobotOutlined, ToolOutlined } from "@ant-design/icons";
import { Empty, Input, Spin, Tag } from "antd";
import { useMemo, useState } from "react";

import type { AgentListItem } from "../../agents/api";

/** Chat Agent 卡片列表参数。 */
type ChatAgentGalleryProps = {
  /** 当前用户可用的 Agent。 */
  agents: AgentListItem[];
  /** Agent 是否正在加载。 */
  loading: boolean;
  /** 选择 Agent 并进入聊天详情。 */
  onOpen: (agentId: string) => void;
};

/** 以工作室卡片展示可对话 Agent，点击后再加载会话与消息区域。 */
export function ChatAgentGallery({ agents, loading, onOpen }: ChatAgentGalleryProps) {
  const [keyword, setKeyword] = useState("");
  const filteredAgents = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return agents;
    return agents.filter((agent) =>
      `${agent.name} ${agent.description} ${agent.providerName} ${agent.modelName}`
        .toLowerCase()
        .includes(normalized)
    );
  }, [agents, keyword]);

  return (
    <div className="chatAgentGallery">
      <div className="chatAgentGalleryToolbar">
        <Input.Search
          allowClear
          placeholder="搜索 Agent"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>
      <Spin spinning={loading}>
        {!loading && filteredAgents.length === 0 ? (
          <Empty
            description={keyword ? "没有匹配的 Agent" : "暂无可用 Agent"}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : null}
        <div className="chatAgentGalleryGrid">
          {filteredAgents.map((agent) => (
            <article
              className="chatAgentCard"
              key={agent.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(agent.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onOpen(agent.id);
              }}
            >
              <div className="chatAgentCardHeader">
                <span className="chatAgentCardIcon">
                  <RobotOutlined />
                </span>
                <div>
                  <strong>{agent.name}</strong>
                  <small>
                    {agent.providerName} / {agent.modelName}
                  </small>
                </div>
              </div>
              <p>{agent.description || "暂无描述"}</p>
              <div className="chatAgentCardBindings">
                <span>
                  <DatabaseOutlined /> 知识库 {agent.knowledgeBaseCount}
                </span>
                <span>
                  <ToolOutlined /> 工具 {agent.toolCount}
                </span>
              </div>
              <div className="chatAgentCardFooter">
                <Tag color={agent.chatSessionMode === "PERSISTENT" ? "blue" : "default"}>
                  {agent.chatSessionMode === "PERSISTENT" ? "保留会话" : "单次会话"}
                </Tag>
                <span>更新于 {formatUpdatedAt(agent.updatedAt)}</span>
              </div>
            </article>
          ))}
        </div>
      </Spin>
    </div>
  );
}

/** 将 Agent 更新时间格式化为卡片底部的紧凑文本。 */
function formatUpdatedAt(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}
