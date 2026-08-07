import { ApartmentOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Empty, Input, Spin, Tag, Tooltip } from "antd";
import { useMemo, useState } from "react";

import type { WorkflowListItem } from "../types";

/** Workflow 卡片工作室参数。 */
type WorkflowGalleryProps = {
  /** 当前 Workflow 摘要列表。 */
  workflows: WorkflowListItem[];
  /** 是否正在加载列表。 */
  loading: boolean;
  /** 打开创建弹窗。 */
  onCreate: () => void;
  /** 进入指定 Workflow 编排详情。 */
  onOpen: (workflowId: string) => void;
  /** 编辑指定 Workflow 的名称和描述。 */
  onEdit: (workflow: WorkflowListItem) => void;
  /** 归档指定 Workflow。 */
  onArchive: (workflow: WorkflowListItem) => void;
};

/** 以工作室卡片展示 Workflow，列表页不加载画布和跨模块资源。 */
export function WorkflowGallery({
  workflows,
  loading,
  onCreate,
  onOpen,
  onEdit,
  onArchive
}: WorkflowGalleryProps) {
  const [keyword, setKeyword] = useState("");
  const filteredWorkflows = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return workflows;
    return workflows.filter((workflow) =>
      `${workflow.name} ${workflow.description}`.toLowerCase().includes(normalized)
    );
  }, [keyword, workflows]);

  return (
    <div className="workflowGallery">
      <div className="workflowGalleryToolbar">
        <Input.Search
          allowClear
          autoComplete="one-time-code"
          placeholder="搜索 Workflow"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>

      <Spin spinning={loading}>
        {!loading && filteredWorkflows.length === 0 ? (
          <Empty description={keyword ? "没有匹配的 Workflow" : "还没有 Workflow"}>
            {!keyword ? (
              <Button type="primary" onClick={onCreate}>
                创建第一个 Workflow
              </Button>
            ) : null}
          </Empty>
        ) : null}
        <div className="workflowGalleryGrid">
          {filteredWorkflows.map((workflow) => (
            <article
              className="workflowGalleryCard"
              key={workflow.id}
              tabIndex={0}
              onClick={() => onOpen(workflow.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onOpen(workflow.id);
              }}
            >
              <div className="workflowGalleryCardHeader">
                <span className="workflowGalleryCardIcon">
                  <ApartmentOutlined />
                </span>
                <div>
                  <strong>{workflow.name}</strong>
                  <small>Workflow</small>
                </div>
                <div className="workflowGalleryCardActions">
                  <Tooltip title="编辑信息">
                    <Button
                      aria-label={`编辑 ${workflow.name}`}
                      icon={<EditOutlined />}
                      type="text"
                      onClick={(event) => {
                        event.stopPropagation();
                        onEdit(workflow);
                      }}
                    />
                  </Tooltip>
                  <Tooltip title="归档 Workflow">
                    <Button
                      danger
                      aria-label={`归档 ${workflow.name}`}
                      icon={<DeleteOutlined />}
                      type="text"
                      onClick={(event) => {
                        event.stopPropagation();
                        onArchive(workflow);
                      }}
                    />
                  </Tooltip>
                </div>
              </div>
              <p>{workflow.description || "暂无描述"}</p>
              <div className="workflowGalleryCardFooter">
                <Tag color={workflow.status === "PUBLISHED" ? "green" : "default"}>
                  {workflow.publishedVersion ? `已发布 v${workflow.publishedVersion}` : "草稿"}
                </Tag>
                <span>更新于 {formatUpdatedAt(workflow.updatedAt)}</span>
              </div>
            </article>
          ))}
        </div>
      </Spin>
    </div>
  );
}

/** 将更新时间压缩为适合卡片底部展示的本地时间。 */
function formatUpdatedAt(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}
