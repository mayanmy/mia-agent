import { CheckCircleOutlined, CloseCircleOutlined, WarningOutlined } from "@ant-design/icons";

import type { WorkflowValidationIssue } from "../types";

export function ValidationPanel({
  issues,
  valid,
  onSelectNode
}: {
  issues: WorkflowValidationIssue[];
  valid: boolean | null;
  onSelectNode: (nodeId: string) => void;
}) {
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
