import {
  ApiOutlined,
  CodeOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  KeyOutlined,
  MessageOutlined,
  MoreOutlined,
  StopOutlined,
  RobotOutlined,
  UploadOutlined,
  ToolOutlined
} from "@ant-design/icons";
import { Button, Dropdown, Empty, Input, Pagination, Spin, Tag, Tooltip } from "antd";
import { useMemo, useState } from "react";
import type { MenuProps } from "antd";

import type { AgentTableItem } from "../types";

type AgentGalleryProps = {
  agents: AgentTableItem[];
  loading: boolean;
  pagination: { page: number; pageSize: number; total: number };
  onPageChange: (page: number, pageSize: number) => void;
  onTest: (agentId: string) => void;
  onPublish: (agentId: string) => void;
  onCopyLink: (agent: AgentTableItem) => void;
  onOpenEmbed: (agent: AgentTableItem) => void;
  onOpenApiKeys: (agent: AgentTableItem) => void;
  onOpenPublicAccess: (agent: AgentTableItem) => void;
  onUnpublish: (agentId: string) => void;
  onEdit: (agentId: string) => void;
  onDelete: (agentId: string) => void;
};

/** 以 AI 应用资源卡片呈现 Agent，管理操作收敛到卡片上下文菜单。 */
export function AgentGallery(props: AgentGalleryProps) {
  const [keyword, setKeyword] = useState("");
  const visibleAgents = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return props.agents;
    return props.agents.filter((agent) =>
      `${agent.name} ${agent.description} ${agent.providerName} ${agent.modelName}`
        .toLowerCase()
        .includes(normalized)
    );
  }, [keyword, props.agents]);

  return (
    <div className="agentGallery">
      <div className="resourceToolbar">
        <Input.Search
          allowClear
          placeholder="搜索 Agent"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <span>{props.pagination.total} 个 Agent</span>
      </div>

      <Spin spinning={props.loading}>
        {!props.loading && visibleAgents.length === 0 ? (
          <Empty description={keyword ? "没有匹配的 Agent" : "还没有 Agent"} />
        ) : null}
        <div className="agentGalleryGrid">
          {visibleAgents.map((agent, index) => (
            <article
              className="agentCard"
              key={agent.id}
              tabIndex={0}
              onClick={() =>
                agent.permissions.canEdit ? props.onEdit(agent.id) : props.onTest(agent.id)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  if (agent.permissions.canEdit) {
                    props.onEdit(agent.id);
                  } else {
                    props.onTest(agent.id);
                  }
                }
              }}
            >
              <header className="agentCardHeader">
                <span className={`agentCardAvatar tone-${index % 5}`}>
                  <RobotOutlined />
                </span>
                <div className="agentCardTitle">
                  <strong>{agent.name}</strong>
                  <span>由 {agent.creator.displayName} 创建</span>
                </div>
                {agent.permissions.canEdit ? (
                  <Dropdown
                    menu={{
                      items: createMenuItems(agent),
                      onClick: ({ key, domEvent }) => {
                        // Dropdown 通过 Portal 渲染，但 React 事件仍会冒泡到卡片，必须在这里阻断。
                        domEvent.stopPropagation();
                        handleMenu(key, agent, props);
                      }
                    }}
                    trigger={["click"]}
                  >
                    <Button
                      aria-label={`${agent.name} 更多操作`}
                      icon={<MoreOutlined />}
                      type="text"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    />
                  </Dropdown>
                ) : null}
              </header>

              <p>{agent.description || "暂无描述，为这个 Agent 补充用途说明。"}</p>

              <div className="agentCardModel">
                <ApiOutlined />
                <span>{agent.providerName}</span>
                <strong>{agent.modelName}</strong>
              </div>
              <div className="agentCardMeta">
                <Tooltip title="绑定工具">
                  <span>
                    <ToolOutlined /> {agent.toolCount}
                  </span>
                </Tooltip>
                <Tooltip title="绑定知识库">
                  <span>
                    <DatabaseOutlined /> {agent.knowledgeBaseCount}
                  </span>
                </Tooltip>
                <Tag bordered={false} color={agent.published ? "blue" : "default"}>
                  {agent.published ? "已发布" : agent.enabled ? "可用" : "已停用"}
                </Tag>
              </div>

              <Button
                block
                className="agentCardChat"
                icon={<MessageOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onTest(agent.id);
                }}
              >
                开始对话
              </Button>
            </article>
          ))}
        </div>
      </Spin>

      {props.pagination.total > props.pagination.pageSize ? (
        <Pagination
          current={props.pagination.page}
          pageSize={props.pagination.pageSize}
          total={props.pagination.total}
          onChange={props.onPageChange}
        />
      ) : null}
    </div>
  );
}

function createMenuItems(agent: AgentTableItem): MenuProps["items"] {
  return [
    agent.published
      ? { key: "copy", icon: <CopyOutlined />, label: "复制分享链接" }
      : { key: "publish", icon: <UploadOutlined />, label: "发布 Agent" },
    ...(agent.published
      ? [
          { key: "embed", icon: <CodeOutlined />, label: "嵌入代码" },
          { key: "api-keys", icon: <KeyOutlined />, label: "服务端 API Key" },
          { key: "public-access", icon: <GlobalOutlined />, label: "公开访问设置" },
          { key: "unpublish", icon: <StopOutlined />, label: "取消发布" }
        ]
      : []),
    { type: "divider" },
    { key: "edit", icon: <EditOutlined />, label: "编辑 Agent" },
    { key: "delete", icon: <DeleteOutlined />, label: "删除 Agent", danger: true }
  ];
}

function handleMenu(key: string, agent: AgentTableItem, props: AgentGalleryProps) {
  if (key === "publish") props.onPublish(agent.id);
  if (key === "copy") props.onCopyLink(agent);
  if (key === "embed") props.onOpenEmbed(agent);
  if (key === "api-keys") props.onOpenApiKeys(agent);
  if (key === "public-access") props.onOpenPublicAccess(agent);
  if (key === "unpublish") props.onUnpublish(agent.id);
  if (key === "edit") props.onEdit(agent.id);
  if (key === "delete") props.onDelete(agent.id);
}
