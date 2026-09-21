import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Tag } from "antd";
import type { ReactNode } from "react";

export type WorkflowEditorChromeProps = {
  /** 当前 Workflow 名称；浮层宽度有限，完整内容通过 title 暴露。 */
  name: string;
  /** 最近发布版本；null 表示当前只有草稿。 */
  publishedVersion: number | null;
  /** 自动保存状态文案，由页面级草稿状态机统一生成。 */
  saveStatus: string;
  /** 编辑、校验和发布操作由页面注入，浮层不持有业务状态。 */
  actions: ReactNode;
  /** 返回 Workflow 列表，不在展示组件内耦合路由。 */
  onBack: () => void;
};

/**
 * 编辑器信息与高频操作悬浮在画布边缘，避免完整页头持续挤占垂直空间。
 * 外层通过 CSS 关闭 pointer-events，只有左右两个白色浮层恢复交互，因此浮层之间的
 * 透明区域仍可拖动画布；属性面板展开或折叠时，CSS 会同步修正右侧安全边界。
 */
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
