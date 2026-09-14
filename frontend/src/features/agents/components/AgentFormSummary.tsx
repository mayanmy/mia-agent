import {
  ApartmentOutlined,
  DatabaseOutlined,
  RobotOutlined,
  ToolOutlined
} from "@ant-design/icons";

type AgentFormSummaryProps = {
  editing: boolean;
  knowledgeCount: number;
  toolCount: number;
  workflowCount: number;
};

/** Agent 配置工作室的上下文摘要，让用户始终知道当前配置对象和已连接能力。 */
export function AgentFormSummary({
  editing,
  knowledgeCount,
  toolCount,
  workflowCount
}: AgentFormSummaryProps) {
  return (
    <header className="agentFormSummary">
      <span className="agentFormSummaryIcon">
        <RobotOutlined />
      </span>
      <div className="agentFormSummaryCopy">
        <strong>{editing ? "调整 Agent 的行为与能力" : "创建一个团队 Agent"}</strong>
        <small>配置模型与指令，并按需连接知识库、工具和 Workflow。</small>
      </div>
      <div className="agentFormSummaryStats" aria-label="已绑定能力">
        <span title="知识库">
          <DatabaseOutlined /> {knowledgeCount}
        </span>
        <span title="工具">
          <ToolOutlined /> {toolCount}
        </span>
        <span title="Workflow">
          <ApartmentOutlined /> {workflowCount}
        </span>
      </div>
    </header>
  );
}
