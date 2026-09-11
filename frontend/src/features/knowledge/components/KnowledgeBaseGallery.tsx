import {
  DatabaseOutlined,
  FileTextOutlined,
  MoreOutlined,
  SearchOutlined
} from "@ant-design/icons";
import { Button, Dropdown, Empty, Input, Pagination, Progress, Spin, Tag } from "antd";
import { useMemo, useState } from "react";
import type { MenuProps } from "antd";

import type { KnowledgeBaseTableItem } from "../types";

type KnowledgeBaseGalleryProps = {
  canManage: boolean;
  knowledgeBases: KnowledgeBaseTableItem[];
  loading: boolean;
  pagination: { page: number; pageSize: number; total: number };
  onPageChange: (page: number, pageSize: number) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenDocuments: (knowledgeBase: KnowledgeBaseTableItem) => void;
};

/** 用内容资产卡片展示知识库容量、索引健康度和文档入口。 */
export function KnowledgeBaseGallery(props: KnowledgeBaseGalleryProps) {
  const [keyword, setKeyword] = useState("");
  const visibleItems = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return props.knowledgeBases;
    return props.knowledgeBases.filter((item) =>
      `${item.name} ${item.description} ${item.embeddingModelName}`
        .toLowerCase()
        .includes(normalized)
    );
  }, [keyword, props.knowledgeBases]);

  return (
    <div className="knowledgeGallery">
      <div className="resourceToolbar">
        <Input.Search
          allowClear
          placeholder="搜索知识库"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <span>{props.pagination.total} 个知识库</span>
      </div>

      <Spin spinning={props.loading}>
        {!props.loading && visibleItems.length === 0 ? (
          <Empty description={keyword ? "没有匹配的知识库" : "还没有知识库"} />
        ) : null}
        <div className="knowledgeGalleryGrid">
          {visibleItems.map((item) => {
            const healthyDocuments = Math.max(0, item.documentCount - item.failedDocumentCount);
            const health = item.documentCount
              ? Math.round((healthyDocuments / item.documentCount) * 100)
              : 100;
            return (
              <article
                className={`knowledgeCard${props.canManage ? " interactive" : ""}`}
                key={item.id}
                tabIndex={props.canManage ? 0 : undefined}
                onClick={() => props.canManage && props.onOpenDocuments(item)}
                onKeyDown={(event) => {
                  if (props.canManage && event.key === "Enter") props.onOpenDocuments(item);
                }}
              >
                <header>
                  <span className="knowledgeCardIcon">
                    <DatabaseOutlined />
                  </span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {item.embeddingProviderName} · {item.embeddingModelName}
                    </small>
                  </div>
                  {props.canManage ? (
                    <Dropdown
                      menu={{
                        items: createMenuItems(),
                        onClick: ({ key }) => {
                          if (key === "documents") props.onOpenDocuments(item);
                          if (key === "edit") props.onEdit(item.id);
                          if (key === "delete") props.onDelete(item.id);
                        }
                      }}
                      trigger={["click"]}
                    >
                      <Button
                        aria-label={`${item.name} 更多操作`}
                        icon={<MoreOutlined />}
                        type="text"
                        onClick={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  ) : null}
                </header>
                <p>{item.description || "用于沉淀团队文档，为 Agent 提供可靠知识。"}</p>
                <div className="knowledgeCardStats">
                  <div>
                    <FileTextOutlined />
                    <strong>{item.documentCount}</strong>
                    <span>文档</span>
                  </div>
                  <div>
                    <SearchOutlined />
                    <strong>{item.chunkCount}</strong>
                    <span>切片</span>
                  </div>
                </div>
                <div className="knowledgeCardHealth">
                  <div>
                    <span>索引健康度</span>
                    <Tag bordered={false} color={item.enabled ? "green" : "default"}>
                      {item.enabled ? "已启用" : "已停用"}
                    </Tag>
                  </div>
                  <Progress
                    percent={health}
                    showInfo={false}
                    size="small"
                    status={item.failedDocumentCount > 0 ? "exception" : "success"}
                  />
                </div>
              </article>
            );
          })}
        </div>
      </Spin>

      {props.pagination.total > props.pagination.pageSize ? (
        <Pagination
          current={props.pagination.page}
          pageSize={props.pagination.pageSize}
          total={props.pagination.total}
          onChange={props.onPageChange}
        />
      ) : null}
    </div>
  );
}

function createMenuItems(): MenuProps["items"] {
  return [
    { key: "documents", label: "管理文档" },
    { key: "edit", label: "编辑配置" },
    { type: "divider" },
    { key: "delete", label: "删除", danger: true }
  ];
}
