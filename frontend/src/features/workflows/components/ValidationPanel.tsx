import { CheckCircleOutlined, CloseCircleOutlined, WarningOutlined } from "@ant-design/icons";

import type { WorkflowValidationIssue } from "../types";

/** Workflow 校验结果浮层参数。 */
type ValidationPanelProps = {
  /** 后端 Compiler 返回的错误和警告。 */
  issues: WorkflowValidationIssue[];
  /** null 表示尚未校验。 */
  valid: boolean | null;
  /** 点击节点级问题时定位画布节点。 */
  onSelectNode: (nodeId: string) => void;
};

/** 展示校验摘要，并允许从问题直接定位节点。 */
export function ValidationPanel({ issues, valid, onSelectNode }: ValidationPanelProps) {
  if (valid === null && issues.length === 0) return null;
  return (
    <section className={`workflowValidation${valid ? " valid" : " invalid"}`}>
      <header>
        {valid ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
        <strong>{valid ? "校验通过" : `${issues.length} 个问题`}</strong>
      </header>
      {issues.length > 0 ? (
        <div className="workflowIssueList">
          {issues.map((issue, index) => (
            <button
              key={`${issue.code}-${issue.nodeId ?? "graph"}-${index}`}
              type="button"
              onClick={() => issue.nodeId && onSelectNode(issue.nodeId)}
            >
              <WarningOutlined />
              <span>{issue.message}</span>
              <code>{[issue.nodeId, issue.field].filter(Boolean).join(" / ")}</code>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
