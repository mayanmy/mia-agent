import {
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  PlusOutlined,
  RollbackOutlined,
  UnorderedListOutlined
} from "@ant-design/icons";
import { Button, Empty, Input, Popconfirm, Tooltip } from "antd";
import { useState } from "react";

import type { ChatSessionListItem } from "../api";

/** Chat 会话侧栏参数。 */
type ChatSessionListProps = {
  /** 当前状态筛选下的会话列表。 */
  sessions: ChatSessionListItem[];
  /** 当前选中会话 ID。 */
  activeSessionId: string | null;
  /** 是否禁止创建和编辑会话。 */
  disabled: boolean;
  /** 会话列表是否正在加载。 */
  loading: boolean;
  /** 当前筛选仍有更多会话。 */
  hasMore: boolean;
  /** 创建新会话回调。 */
  onCreate: () => void;
  /** 选择会话回调。 */
  onSelect: (sessionId: string) => void;
  /** 重命名会话回调。 */
  onRename: (sessionId: string, title: string) => void;
  /** 归档会话回调。 */
  onArchive: (sessionId: string) => void;
  /** 恢复会话回调。 */
  onRestore: (sessionId: string) => void;
  /** 永久删除归档会话回调。 */
  onDelete: (sessionId: string) => void;
  /** 当前是否展示归档会话。 */
  showingArchived: boolean;
  /** 切换活跃/归档视图回调。 */
  onToggleArchived: () => void;
  /** 加载下一页会话。 */
  onLoadMore: () => void;
};

/** 展示并管理当前 Agent 的持久会话。 */
export function ChatSessionList({
  sessions,
  activeSessionId,
  disabled,
  loading,
  hasMore,
  onCreate,
  onSelect,
  onRename,
  onArchive,
  onRestore,
  onDelete,
  showingArchived,
  onToggleArchived,
  onLoadMore
}: ChatSessionListProps) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredSessions = normalizedSearch
    ? sessions.filter((session) => session.title.toLocaleLowerCase().includes(normalizedSearch))
    : sessions;

  function startRename(session: ChatSessionListItem) {
    setEditingSessionId(session.id);
    setTitle(session.title);
  }

  function submitRename() {
    if (!editingSessionId || !title.trim()) {
      return;
    }

    onRename(editingSessionId, title.trim());
    setEditingSessionId(null);
  }

  return (
    <section className="chatSessionSection">
      <div className="chatSessionHeader">
        <h3>{showingArchived ? "已归档会话" : "历史会话"}</h3>
        <div className="chatSessionHeaderActions">
          <Tooltip title={showingArchived ? "返回历史会话" : "查看已归档会话"}>
            <Button
              aria-label={showingArchived ? "返回历史会话" : "查看已归档会话"}
              disabled={disabled}
              icon={showingArchived ? <UnorderedListOutlined /> : <InboxOutlined />}
              size="small"
              type="text"
              onClick={onToggleArchived}
            />
          </Tooltip>
          {!showingArchived ? (
            <Tooltip title="新建对话">
              <Button
                aria-label="新建对话"
                disabled={disabled}
                icon={<PlusOutlined />}
                loading={loading}
                size="small"
                type="text"
                onClick={onCreate}
              />
            </Tooltip>
          ) : null}
        </div>
      </div>
      <Input.Search
        allowClear
        className="chatSessionSearch"
        placeholder="搜索已加载会话"
        size="small"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {filteredSessions.length === 0 ? (
        <Empty
          className="chatSessionEmpty"
          description={
            normalizedSearch
              ? "没有匹配的会话"
              : showingArchived
                ? "暂无已归档会话"
                : "暂无历史会话"
          }
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div className="chatSessionList">
          {filteredSessions.map((session, index) => {
            const isEditing = editingSessionId === session.id;
            const isActive = activeSessionId === session.id;
            const group = getSessionTimeGroup(session);
            const previousGroup = index > 0 ? getSessionTimeGroup(filteredSessions[index - 1]!) : null;

            return (
              <div className="chatSessionGroup" key={session.id}>
                {group !== previousGroup ? (
                  <div className="chatSessionGroupLabel">{group}</div>
                ) : null}
                <div className={`chatSessionItem${isActive ? " active" : ""}`}>
                {isEditing ? (
                  <Input
                    autoFocus
                    maxLength={80}
                    size="small"
                    value={title}
                    onBlur={submitRename}
                    onChange={(event) => setTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        submitRename();
                      }

                      if (event.key === "Escape") {
                        setEditingSessionId(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    className="chatSessionTitle"
                    disabled={disabled}
                    type="button"
                    onClick={() => onSelect(session.id)}
                  >
                    {session.title || "新对话"}
                  </button>
                )}
                {showingArchived ? (
                  <div className="chatSessionActions">
                    <Tooltip title="恢复">
                      <Button
                        aria-label="恢复会话"
                        disabled={disabled}
                        icon={<RollbackOutlined />}
                        size="small"
                        type="text"
                        onClick={() => onRestore(session.id)}
                      />
                    </Tooltip>
                    <Tooltip title="删除">
                      <Popconfirm
                        cancelText="取消"
                        description="会话及其所有消息将永久删除，无法恢复。"
                        okButtonProps={{ danger: true }}
                        okText="永久删除"
                        title="删除归档会话"
                        onConfirm={() => onDelete(session.id)}
                      >
                        <Button
                          danger
                          aria-label="删除归档会话"
                          disabled={disabled}
                          icon={<DeleteOutlined />}
                          size="small"
                          type="text"
                        />
                      </Popconfirm>
                    </Tooltip>
                  </div>
                ) : isActive && !isEditing ? (
                  <div className="chatSessionActions">
                    <Tooltip title="重命名">
                      <Button
                        aria-label="重命名会话"
                        disabled={disabled}
                        icon={<EditOutlined />}
                        size="small"
                        type="text"
                        onClick={() => startRename(session)}
                      />
                    </Tooltip>
                    <Tooltip title="归档">
                      <Popconfirm
                        title="归档会话"
                        description="确认归档会话？"
                        okText="确认"
                        cancelText="取消"
                        onConfirm={() => onArchive(session.id)}
                      >
                        <Button
                          aria-label="归档会话"
                          disabled={disabled}
                          icon={<InboxOutlined />}
                          size="small"
                          type="text"
                        />
                      </Popconfirm>
                    </Tooltip>
                  </div>
                ) : null}
                </div>
              </div>
            );
          })}
          {hasMore ? (
            <Button block loading={loading} size="small" type="text" onClick={onLoadMore}>
              加载更多会话
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function getSessionTimeGroup(session: ChatSessionListItem): string {
  const value = session.lastMessageAt || session.createdAt;
  const date = new Date(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const timestamp = date.getTime();

  if (timestamp >= startOfToday) return "今天";
  if (timestamp >= startOfToday - day) return "昨天";
  if (timestamp >= startOfToday - 7 * day) return "近 7 天";
  return "更早";
}
