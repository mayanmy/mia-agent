import {
  ApartmentOutlined,
  ArrowRightOutlined,
  DatabaseOutlined,
  MessageOutlined,
  PlusOutlined,
  RobotOutlined,
  ToolOutlined
} from "@ant-design/icons";
import { Button, Spin } from "antd";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { listAgents, type AgentListItem } from "../agents/api";
import { useAuth } from "../auth/AuthProvider";
import { listKnowledgeBases, type KnowledgeBaseListItem } from "../knowledge/api";
import { useWorkspace } from "../workspaces/WorkspaceProvider";
import { listPublishedWorkflowApps, listWorkflows } from "../workflows/api";
import "./home.less";

type HomeSummary = {
  agents: AgentListItem[];
  agentTotal: number;
  knowledgeBases: KnowledgeBaseListItem[];
  knowledgeTotal: number;
  workflowTotal: number;
};

const emptySummary: HomeSummary = {
  agents: [],
  agentTotal: 0,
  knowledgeBases: [],
  knowledgeTotal: 0,
  workflowTotal: 0
};

/** 聚合近期 AI 资源和高频入口，作为工作空间而非管理菜单的默认落点。 */
export function HomePage() {
  const { currentUser } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const [summary, setSummary] = useState<HomeSummary>(emptySummary);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    const workflowRequest =
      currentWorkspace?.role === "MEMBER"
        ? listPublishedWorkflowApps().then((items) => items.length)
        : listWorkflows(1, 4).then((page) => page.total);

    void Promise.all([listAgents(1, 4), listKnowledgeBases(1, 4), workflowRequest])
      .then(([agentPage, knowledgePage, workflowTotal]) => {
        if (disposed) return;
        setSummary({
          agents: agentPage.list,
          agentTotal: agentPage.total,
          knowledgeBases: knowledgePage.list,
          knowledgeTotal: knowledgePage.total,
          workflowTotal
        });
      })
      .catch(() => {
        if (!disposed) setSummary(emptySummary);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [currentWorkspace?.role]);

  const displayName = currentUser?.displayName?.trim() || "伙伴";
  // 后端健康信息属于平台运维范围，空间所有者和项目管理员也不应看到。
  const canViewHealthStatus = currentUser?.role === "ADMIN";

  return (
    <section className="homeWorkspace">
      <header className="homeHero">
        <div className="homeHeroIntro">
          <span className="homeEyebrow">{currentWorkspace?.name}</span>
          <h1>{displayName}，今天从哪里开始？</h1>
          <p>构建、使用和观察团队 Agent，都集中在这一个工作台。</p>
        </div>
        <div className="homeHeroAction">
          <Link to="/agents">
            <Button icon={<PlusOutlined />} size="large" type="primary">
              创建 Agent
            </Button>
          </Link>
        </div>
        <div
          className={`homeRuntimeRail${canViewHealthStatus ? "" : " resourcesOnly"}`}
          aria-label="工作空间资源概览"
        >
          {canViewHealthStatus ? (
            <>
              <span className="homeRuntimePulse" aria-hidden="true" />
              <strong>工作空间就绪</strong>
            </>
          ) : null}
          <div>
            <b>{summary.agentTotal}</b>
            <small>Agent</small>
          </div>
          <div>
            <b>{summary.knowledgeTotal}</b>
            <small>知识库</small>
          </div>
          <div>
            <b>{summary.workflowTotal}</b>
            <small>Workflow</small>
          </div>
          {canViewHealthStatus ? (
            <Link to="/operations">
              查看运行状态 <ArrowRightOutlined />
            </Link>
          ) : null}
        </div>
      </header>

      <section className="homeQuickGrid" aria-label="快捷入口">
        <HomeQuickLink
          description="创建和配置团队 AI 助手"
          icon={<RobotOutlined />}
          label="构建 Agent"
          path="/agents"
          tone="primary"
        />
        <HomeQuickLink
          description="立即开始一次智能对话"
          icon={<MessageOutlined />}
          label="开始对话"
          path="/chat"
          tone="blue"
        />
        <HomeQuickLink
          description="沉淀团队文档与知识"
          icon={<DatabaseOutlined />}
          label="添加知识"
          path="/knowledge"
          tone="green"
        />
        <HomeQuickLink
          description="编排稳定可复用的流程"
          icon={<ApartmentOutlined />}
          label="设计 Workflow"
          path="/workflows"
          tone="orange"
        />
      </section>

      <Spin spinning={loading}>
        <section className="homeOverviewGrid">
          <div className="homeResourceSection">
            <div className="homeSectionHeader">
              <div>
                <h2>最近的 Agent</h2>
                <span>{summary.agentTotal} 个团队助手</span>
              </div>
              <Link to="/agents">
                查看全部 <ArrowRightOutlined />
              </Link>
            </div>
            <div className="homeRecentList">
              {summary.agents.length ? (
                summary.agents.map((agent) => (
                  <Link className="homeRecentItem" key={agent.id} to={`/chat?agentId=${agent.id}`}>
                    <span className="homeRecentIcon agent">
                      <RobotOutlined />
                    </span>
                    <span>
                      <strong>{agent.name}</strong>
                      <small>
                        {agent.description || `${agent.providerName} · ${agent.modelName}`}
                      </small>
                    </span>
                    <ArrowRightOutlined />
                  </Link>
                ))
              ) : (
                <HomeEmpty text="还没有 Agent，创建一个开始体验" path="/agents" />
              )}
            </div>
          </div>

          <div className="homeResourceSection">
            <div className="homeSectionHeader">
              <div>
                <h2>团队知识</h2>
                <span>
                  {summary.knowledgeTotal} 个知识库 · {summary.workflowTotal} 个 Workflow
                </span>
              </div>
              <Link to="/knowledge">
                查看全部 <ArrowRightOutlined />
              </Link>
            </div>
            <div className="homeRecentList">
              {summary.knowledgeBases.length ? (
                summary.knowledgeBases.map((item) => (
                  <Link className="homeRecentItem" key={item.id} to="/knowledge">
                    <span className="homeRecentIcon knowledge">
                      <DatabaseOutlined />
                    </span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {item.documentCount} 个文档 · {item.chunkCount} 个切片
                      </small>
                    </span>
                    <ArrowRightOutlined />
                  </Link>
                ))
              ) : (
                <HomeEmpty text="上传文档，让 Agent 使用团队知识" path="/knowledge" />
              )}
            </div>
          </div>
        </section>
      </Spin>

      <footer className="homeCapabilityBanner">
        <span>
          <ToolOutlined />
        </span>
        <div>
          <strong>连接更多能力</strong>
          <small>通过工具、MCP 和 Skill 扩展 Agent 的执行边界。</small>
        </div>
        <Link to="/capabilities">
          管理扩展能力 <ArrowRightOutlined />
        </Link>
      </footer>
    </section>
  );
}

function HomeQuickLink({
  description,
  icon,
  label,
  path,
  tone
}: {
  description: string;
  icon: ReactNode;
  label: string;
  path: string;
  tone: string;
}) {
  return (
    <Link className={`homeQuickCard ${tone}`} to={path}>
      <span>{icon}</span>
      <div>
        <strong>{label}</strong>
        <small>{description}</small>
      </div>
      <ArrowRightOutlined />
    </Link>
  );
}

function HomeEmpty({ text, path }: { text: string; path: string }) {
  return (
    <Link className="homeEmpty" to={path}>
      {text}
      <ArrowRightOutlined />
    </Link>
  );
}
