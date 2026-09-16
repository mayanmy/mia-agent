import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Tag } from "antd";
import type { ReactNode } from "react";

export type WorkflowEditorChromeProps = {
  name: string;
  publishedVersion: number | null;
  saveStatus: string;
  actions: ReactNode;
  onBack: () => void;
};

/** 编辑器信息与高频操作悬浮在画布边缘，避免完整页头挤占垂直空间。 */
export function WorkflowEditorChrome({
  name,
  publishedVersion,
  saveStatus,
  actions,
  onBack
}: WorkflowEditorChromeProps) {
  return (
    <div className="workflowEditorChrome">
      <div className="workflowEditorIdentity">
        <Button
          aria-label="返回 Workflow 工作室"
          icon={<ArrowLeftOutlined />}
          title="返回 Workflow 工作室"
          type="text"
          onClick={onBack}
        />
        <div className="workflowEditorIdentityText">
          <strong title={name}>{name}</strong>
          <span>{saveStatus}</span>
        </div>
        <Tag color={publishedVersion ? "green" : "default"}>
          {publishedVersion ? `v${publishedVersion}` : "未发布"}
        </Tag>
      </div>
      <div className="workflowEditorFloatingActions">{actions}</div>
    </div>
  );
}
