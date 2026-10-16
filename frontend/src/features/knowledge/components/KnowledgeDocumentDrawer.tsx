import { Alert, Button, Drawer, Popconfirm, Space, Table, Tag, Tooltip, Upload } from "antd";
import type { TableProps } from "antd";

import type { KnowledgeBaseTableItem, KnowledgeDocumentTableItem } from "../types";

type UploadRequestOptions = {
  file: string | Blob;
  onError?: (error: Error) => void;
  onSuccess?: (response: unknown) => void;
};

export function KnowledgeDocumentDrawer({
  open,
  knowledgeBase,
  documents,
  loading,
  uploading,
  pagination,
  onClose,
  onDelete,
  onPageChange,
  onReindex,
  onRefresh,
  onUpload
}: {
  open: boolean;
  knowledgeBase: KnowledgeBaseTableItem | null;
  documents: KnowledgeDocumentTableItem[];
  loading: boolean;
  uploading: boolean;
  pagination: { page: number; pageSize: number; total: number };
  onClose: () => void;
  onDelete: (documentId: string) => void;
  onPageChange: (page: number, pageSize: number) => void;
  onReindex: (documentId: string) => void;
  onRefresh: () => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const failedCount = documents.filter((document) => document.status === "failed").length;
  const columns: TableProps<KnowledgeDocumentTableItem>["columns"] = [
    {
      title: "文件名",
      dataIndex: "originalFilename",
      key: "originalFilename",
      fixed: "left",
      width: 240
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => renderStatus(status)
    },
    {
      title: "大小",
      dataIndex: "fileSize",
      key: "fileSize",
      width: 110,
      render: (fileSize: string) => formatFileSize(Number(fileSize))
    },
    {
      title: "Chunk",
      dataIndex: "chunkCount",
      key: "chunkCount",
      width: 90
    },
    {
      title: "错误",
      dataIndex: "errorMessage",
      key: "errorMessage",
      width: 260,
      render: (message: string | null, record) =>
        message ? <ErrorMessageCell message={message} status={record.status} /> : "-"
    },
    {
      title: "索引时间",
      dataIndex: "indexedAt",
      key: "indexedAt",
      width: 180,
      render: (indexedAt: string | null) => (indexedAt ? formatDate(indexedAt) : "-")
    },
    {
      title: "上传时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (createdAt: string) => formatDate(createdAt)
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 150,
      render: (_, record) => {
        const indexing = isIndexingStatus(record.status);

        return (
          <Space size={2}>
            <Popconfirm
              cancelText="取消"
              okText={record.status === "failed" ? "重试" : "重建"}
              title={record.status === "failed" ? "重试索引这个失败文档？" : "重建这个文档索引？"}
              onConfirm={() => onReindex(record.id)}
            >
              <Button disabled={indexing} size="small" type="link">
                {record.status === "failed" ? "重试" : "重建"}
              </Button>
            </Popconfirm>
            <Popconfirm
              cancelText="取消"
              okButtonProps={{ danger: true }}
              okText="删除"
              title="删除这个文档？"
              onConfirm={() => onDelete(record.id)}
            >
              <Button danger size="small" type="link">
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      }
    }
  ];

  return (
    <Drawer
      destroyOnHidden
      extra={
        <Space>
          <Button disabled={loading} onClick={onRefresh}>
            刷新
          </Button>
          <Upload
            accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json"
            customRequest={(options) => void handleUpload(options, onUpload)}
            disabled={!knowledgeBase || uploading}
            maxCount={1}
            showUploadList={false}
          >
            <Button loading={uploading} type="primary">
              上传文档
            </Button>
          </Upload>
        </Space>
      }
      open={open}
      title={knowledgeBase ? `${knowledgeBase.name} · 文档` : "知识库文档"}
      width={960}
      onClose={onClose}
    >
      {failedCount > 0 ? (
        <Alert
          className="knowledgeDocumentAlert"
          message={`有 ${failedCount} 个文档索引失败，可查看失败原因后点击“重试”。`}
          showIcon
          type="warning"
        />
      ) : null}
      <Table<KnowledgeDocumentTableItem>
        columns={columns}
        dataSource={documents}
        loading={loading}
        pagination={{
          current: pagination.page,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true
        }}
        rowKey="id"
        scroll={{ x: 1270 }}
        onChange={(nextPagination) => {
          onPageChange(nextPagination.current || 1, nextPagination.pageSize || 20);
        }}
      />
    </Drawer>
  );
}

async function handleUpload(
  options: UploadRequestOptions,
  onUpload: (file: File) => Promise<void>
) {
  try {
    await onUpload(options.file as File);
    options.onSuccess?.("ok");
  } catch (error) {
    options.onError?.(error as Error);
  }
}

function ErrorMessageCell({ message, status }: { message: string; status: string }) {
  const text = getReadableErrorMessage(message);

  return (
    <Tooltip title={text}>
      <span className={status === "failed" ? "knowledgeDocumentError" : undefined}>{text}</span>
    </Tooltip>
  );
}

function renderStatus(status: string) {
  const statusMap: Record<string, { color: string; label: string }> = {
    uploaded: { color: "blue", label: "已上传" },
    pending: { color: "gold", label: "待处理" },
    processing: { color: "processing", label: "处理中" },
    parsing: { color: "processing", label: "解析中" },
    chunking: { color: "processing", label: "切分中" },
    embedding: { color: "processing", label: "向量化中" },
    indexed: { color: "green", label: "已索引" },
    failed: { color: "red", label: "失败" },
    deleted: { color: "default", label: "已删除" }
  };
  const item = statusMap[status] ?? { color: "default", label: status };

  return <Tag color={item.color}>{item.label}</Tag>;
}

function isIndexingStatus(status: string): boolean {
  return ["pending", "processing", "parsing", "chunking", "embedding"].includes(status);
}

function getReadableErrorMessage(message: string): string {
  if (message.includes("document text is empty")) {
    return "文档内容为空，无法生成索引";
  }

  if (message.includes("embedding response count does not match chunk count")) {
    return "向量化结果数量异常，请重试索引";
  }

  if (
    message.includes("Embedding 向量维度不匹配") ||
    message.includes("expected 1536 dimensions")
  ) {
    return message.includes("Embedding 向量维度不匹配")
      ? message
      : "Embedding 向量维度不匹配：当前数据库需要 1536 维，但模型返回了其他维度。请更换匹配维度的 Embedding 模型。";
  }

  if (message.includes("only text documents")) {
    return "当前仅支持文本类文档重建索引";
  }

  return message;
}

function formatFileSize(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
