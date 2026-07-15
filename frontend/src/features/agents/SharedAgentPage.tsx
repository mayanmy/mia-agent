import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Result, Spin, Tag, message } from "antd";

import { getSharedAgent, type SharedAgentDetail } from "./api";
import "./agents.less";

export function SharedAgentPage() {
  const navigate = useNavigate();
  const { token } = useParams();
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
        <Button type="primary" onClick={() => navigate(`/chat?agentId=${agent.id}`)}>
          开始对话
        </Button>
      </div>
    </section>
  );
}
