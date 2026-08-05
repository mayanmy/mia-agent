import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button } from "antd";
import type { ReactNode } from "react";

/** 工作室首页与详情页共用的标题骨架参数。 */
export type WorkspacePageHeaderProps = {
  /** 页面主标题或当前对象名称。 */
  title: ReactNode;
  /** 主标题下方的一句话说明。 */
  description: ReactNode;
  /** 详情页用于标识所属模块的上级标题。 */
  eyebrow?: ReactNode;
  /** 标题同行展示的状态、版本等轻量元数据。 */
  meta?: ReactNode;
  /** 页面右侧的主要和辅助操作。 */
  actions?: ReactNode;
  /** 返回按钮文案；仅设置 onBack 时展示。 */
  backLabel?: string;
  /** 从详情页返回工作室首页。 */
  onBack?: () => void;
};

/** 统一工作室首页和详情页的返回、标题、状态与操作层级。 */
export function WorkspacePageHeader({
  title,
  description,
  eyebrow,
  meta,
  actions,
  backLabel = "返回",
  onBack
}: WorkspacePageHeaderProps) {
  return (
    <header className="workspacePageHeader">
      <div className="workspacePageHeaderIdentity">
        {onBack ? (
          <Button
            aria-label={backLabel}
            className="workspacePageBack"
            icon={<ArrowLeftOutlined />}
            title={backLabel}
            type="text"
            onClick={onBack}
          />
        ) : null}
        <div className="workspacePageHeading">
          {eyebrow ? <div className="workspacePageEyebrow">{eyebrow}</div> : null}
          <div className="workspacePageTitleRow">
            <h1>{title}</h1>
            {meta ? <div className="workspacePageMeta">{meta}</div> : null}
          </div>
          <p>{description}</p>
        </div>
      </div>
      {actions ? <div className="workspacePageActions">{actions}</div> : null}
    </header>
  );
}
