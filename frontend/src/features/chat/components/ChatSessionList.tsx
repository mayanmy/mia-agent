import { EditOutlined, InboxOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Empty, Input, Popconfirm, Tooltip } from "antd";
import { useState } from "react";

import type { ChatSessionListItem } from "../api";

export function ChatSessionList({
  sessions,
  activeSessionId,
  disabled,
  loading,
  onCreate,
  onSelect,
  onRename,
  onArchive
}: {
  sessions: ChatSessionListItem[];
  activeSessionId: string | null;
  disabled: boolean;
  loading: boolean;
  onCreate: () => void;
  onSelect: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  onArchive: (sessionId: string) => void;
}) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [title, setTitle] = useState("");

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
        <h3>历史会话</h3>
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
      </div>
      {sessions.length === 0 ? (
        <Empty
          className="chatSessionEmpty"
          description="暂无历史会话"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div className="chatSessionList">
          {sessions.map((session) => {
            const isEditing = editingSessionId === session.id;
            const isActive = activeSessionId === session.id;

            return (
              <div className={`chatSessionItem${isActive ? " active" : ""}`} key={session.id}>
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
                {isActive && !isEditing ? (
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
            );
          })}
        </div>
      )}
    </section>
  );
}
