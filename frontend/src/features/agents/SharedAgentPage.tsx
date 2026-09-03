import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Result, Spin, Tag, message } from "antd";

import { getSharedAgent, type SharedAgentDetail } from "./api";
import "./agents.less";

export function SharedAgentPage() {
  const { token } = useParams();
  const widgetContainerRef = useRef<HTMLDivElement | null>(null);
  const [agent, setAgent] = useState<SharedAgentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;

    async function loadSharedAgent() {
      if (!token) {
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const sharedAgent = await getSharedAgent(token);
        if (!disposed) {
          setAgent(sharedAgent);
        }
      } catch (error) {
        if (!disposed) {
          message.error(error instanceof Error ? error.message : "分享链接不可用");
          setAgent(null);
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    }

    void loadSharedAgent();
    return () => {
      // token 变化和页面卸载都必须使旧请求失效，避免旧链接覆盖新页面状态。
      disposed = true;
    };
  }, [token]);

  useEffect(() => {
    const container = widgetContainerRef.current;

    if (!container || !token || !agent) {
      return undefined;
    }

    const script = document.createElement("script");
    // 公开页复用同一份压缩 Widget；它只携带可公开的 agentToken，不会引入工作台登录 Token。
    script.async = true;
    script.src = `${window.location.origin}/mia-agent-widget.min.js`;
    script.setAttribute("data-agent-token", token);
    const externalUserId = new URLSearchParams(window.location.search).get("user_id");
    if (externalUserId) {
      script.setAttribute("data-user-id", externalUserId);
    }
    script.setAttribute("data-api-base", window.location.origin);
    script.setAttribute("data-agent-name", agent.name);
    script.setAttribute("data-mode", "inline");
    script.setAttribute("data-container", "#mia-public-agent-chat");
    document.body.appendChild(script);

    return () => {
      // 路由切换后同时移除动态脚本和 widget 根节点，避免下一条公开链接复用旧 Agent 视图。
      script.remove();
      container.replaceChildren();
    };
  }, [agent, token]);

  if (loading) {
    return (
      <section className="workspace sharedAgentWorkspace">
        <Spin />
      </section>
    );
  }

  if (!agent) {
    return (
      <section className="workspace sharedAgentWorkspace">
        <Result
          status="404"
          title="分享链接不可用"
          subTitle="这个 Agent 未发布、已停用或链接不存在。"
        />
      </section>
    );
  }

  return (
    <section className="workspace sharedAgentWorkspace">
      <div className="sharedAgentPanel">
        <div>
          <p className="eyebrow">Shared Agent</p>
          <h1>{agent.name}</h1>
          <p className="sharedAgentDescription">{agent.description || "这个 Agent 暂无描述。"}</p>
          <div className="sharedAgentMeta">
            <Tag color="blue">已发布</Tag>
            <span>
              {agent.providerName} / {agent.modelName}
            </span>
          </div>
        </div>
      </div>
      <div className="sharedAgentChat" id="mia-public-agent-chat" ref={widgetContainerRef} />
    </section>
  );
}
