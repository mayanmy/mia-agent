import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Empty, Input, Select, Space, Spin, Tag, message } from "antd";

import { listAgents, type AgentListItem } from "../agents/api";
import { createChatCompletion, type ChatMessage } from "./api";

type ChatUiMessage = ChatMessage & {
  id: string;
};

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(searchParams.get("agentId") || "");
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [sending, setSending] = useState(false);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );

  useEffect(() => {
    void refreshAgents();
  }, []);

  async function refreshAgents() {
    setLoadingAgents(true);

    try {
      const page = await listAgents(1, 100);
      const enabledAgents = page.list.filter((agent) => agent.enabled);
      const nextAgentId = searchParams.get("agentId") || selectedAgentId || enabledAgents[0]?.id || "";

      setAgents(enabledAgents);
      setSelectedAgentId(nextAgentId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载 Agent 失败");
    } finally {
      setLoadingAgents(false);
    }
  }

  function handleAgentChange(agentId: string) {
    setSelectedAgentId(agentId);
    setMessages([]);

    if (agentId) {
      setSearchParams({ agentId });
    } else {
      setSearchParams({});
    }
  }

  async function handleSend() {
    const content = input.trim();

    if (!selectedAgentId) {
      message.warning("请选择 Agent");
      return;
    }

    if (!content) {
      return;
    }

    const nextUserMessage: ChatUiMessage = {
      id: createMessageId(),
      role: "user",
      content
    };
    const history = messages.map(({ role, content: messageContent }) => ({
      role,
      content: messageContent
    }));

    setMessages((current) => [...current, nextUserMessage]);
    setInput("");
    setSending(true);

    try {
      const result = await createChatCompletion({
        agentId: selectedAgentId,
        message: content,
        history
      });

      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content: result.content || ""
        }
      ]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "对话失败");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="workspace chatWorkspace">
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Chat</p>
          <h1>测试对话</h1>
        </div>
        <Space>
          <Button disabled={loadingAgents} onClick={() => void refreshAgents()}>
            刷新 Agent
          </Button>
        </Space>
      </header>

      <div className="chatLayout">
        <aside className="chatSide panel">
          <div className="panelHeader">
            <h2>Agent</h2>
          </div>
          <div className="chatSideBody">
            <Select
              loading={loadingAgents}
              options={agents.map((agent) => ({
                label: `${agent.name} · ${agent.providerName} / ${agent.modelName}`,
                value: agent.id
              }))}
              placeholder="请选择 Agent"
              value={selectedAgentId || undefined}
              onChange={handleAgentChange}
            />
            {selectedAgent ? (
              <div className="chatAgentMeta">
                <div className="chatAgentName">{selectedAgent.name}</div>
                <div className="chatAgentModel">
                  {selectedAgent.providerName} / {selectedAgent.modelName}
                </div>
                <Tag color="green">已启用</Tag>
              </div>
            ) : (
              <Empty description="暂无可用 Agent" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </div>
        </aside>

        <div className="chatPanel panel">
          <div className="chatMessages">
            {messages.length === 0 ? (
              <Empty description="发送一条消息测试 Agent" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              messages.map((item) => (
                <div className={`chatMessage ${item.role}`} key={item.id}>
                  <div className="chatMessageRole">{item.role === "user" ? "你" : "Agent"}</div>
                  <div className="chatMessageBubble">{item.content}</div>
                </div>
              ))
            )}
            {sending ? (
              <div className="chatMessage assistant">
                <div className="chatMessageRole">Agent</div>
                <div className="chatMessageBubble">
                  <Spin size="small" /> 正在生成...
                </div>
              </div>
            ) : null}
          </div>
          <div className="chatComposer">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 6 }}
              disabled={!selectedAgentId || sending}
              placeholder="输入消息，测试当前 Agent 的真实模型调用"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
            />
            <Button
              disabled={!selectedAgentId || !input.trim()}
              loading={sending}
              type="primary"
              onClick={() => void handleSend()}
            >
              发送
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
