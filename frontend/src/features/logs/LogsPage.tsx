import { useEffect, useState } from "react";
import {
  Button,
  DatePicker,
  Drawer,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { TableProps } from "antd";
import type { Dayjs } from "dayjs";

import { listToolCallLogs, type ToolCallLogListItem, type ToolCallLogQuery } from "./api";
import "./logs.less";

const { RangePicker } = DatePicker;

const statusOptions = [
  { label: "可用工具", value: "available" },
  { label: "已请求", value: "requested" },
  { label: "完成", value: "completed" },
  { label: "失败", value: "failed" },
  { label: "跳过", value: "skipped" }
];

type LogFilters = Omit<ToolCallLogQuery, "page" | "pageSize" | "createdFrom" | "createdTo"> & {
  createdRange?: [Dayjs, Dayjs] | null;
};

export function LogsPage() {
  const [toolCallLogs, setToolCallLogs] = useState<ToolCallLogListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<LogFilters>({});
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [detailLog, setDetailLog] = useState<ToolCallLogListItem | null>(null);

  useEffect(() => {
    void refresh(1, pagination.pageSize);
  }, []);

  async function refresh(
    nextPage = pagination.page,
    nextPageSize = pagination.pageSize,
    nextFilters = filters
  ) {
    setLoading(true);

    try {
      const page = await listToolCallLogs({
        ...normalizeFilters(nextFilters),
        page: nextPage,
        pageSize: nextPageSize
      });

      setToolCallLogs(page.list);
      setPagination({
        page: page.page,
        pageSize: page.pageSize,
        total: page.total
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载工具调用日志失败");
    } finally {
      setLoading(false);
    }
  }

  function updateFilter<K extends keyof LogFilters>(key: K, value: LogFilters[K]) {
    setFilters((current) => ({
      ...current,
      [key]: value
    }));
  }

  function resetFilters() {
    setFilters({});
    void refresh(1, pagination.pageSize, {});
  }

  const columns: TableProps<ToolCallLogListItem>["columns"] = [
    {
      title: "Agent ID",
      dataIndex: "agentId",
      key: "agentId",
      fixed: "left",
      width: 220,
      render: (agentId: string | null) =>
        agentId ? (
          <Typography.Text copyable className="logMonoText">
            {agentId}
          </Typography.Text>
        ) : (
          "-"
        )
    },
    {
      title: "时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (createdAt: string) => formatDate(createdAt)
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => <Tag color={getStatusColor(status)}>{formatStatus(status)}</Tag>
    },
    {
      title: "工具",
      dataIndex: "toolId",
      key: "toolId",
      width: 150,
      render: (toolId: string | null) => toolId || "-"
    },
    {
      title: "来源",
      dataIndex: "source",
      key: "source",
      width: 130,
      render: (source: string | null) => formatSource(source)
    },
    {
      title: "原因",
      dataIndex: "reason",
      key: "reason",
      width: 190,
      render: (reason: string | null) => reason || "-"
    },
    {
      title: "错误类型",
      dataIndex: "errorType",
      key: "errorType",
      width: 160,
      render: (errorType: string | null) => errorType || "-"
    },
    {
      title: "错误信息",
      dataIndex: "errorMessage",
      key: "errorMessage",
      width: 260,
      render: (errorMessage: string | null) =>
        errorMessage ? (
          <Typography.Text className="logErrorMessage" title={errorMessage}>
            {errorMessage}
          </Typography.Text>
        ) : (
          "-"
        )
    },
    {
      title: "耗时",
      dataIndex: "elapsedMs",
      key: "elapsedMs",
      width: 100,
      render: (elapsedMs: number | null) => (elapsedMs === null ? "-" : `${elapsedMs}ms`)
    },
    {
      title: "Request ID",
      dataIndex: "requestId",
      key: "requestId",
      width: 220,
      render: (requestId: string | null) =>
        requestId ? (
          <Typography.Text copyable className="logMonoText">
            {requestId}
          </Typography.Text>
        ) : (
          "-"
        )
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 100,
      render: (_, record) => (
        <Button size="small" type="link" onClick={() => setDetailLog(record)}>
          查看详情
        </Button>
      )
    }
  ];

  return (
    <section className="workspace logsWorkspace">
      <header className="compactPageHeader">
        <div>
          <h1>工具调用日志</h1>
          <p>查看工具选择、执行结果和失败原因。</p>
        </div>
        <Button
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => void refresh(pagination.page, pagination.pageSize)}
        >
          刷新
        </Button>
      </header>

      <section className="panel logsFilterPanel">
        <Input
          allowClear
          placeholder="Request ID"
          value={filters.requestId}
          onChange={(event) => updateFilter("requestId", event.target.value)}
        />
        <Input
          allowClear
          placeholder="Agent ID"
          value={filters.agentId}
          onChange={(event) => updateFilter("agentId", event.target.value)}
        />
        <Input
          allowClear
          placeholder="工具 ID"
          value={filters.toolId}
          onChange={(event) => updateFilter("toolId", event.target.value)}
        />
        <Select
          allowClear
          options={statusOptions}
          placeholder="状态"
          value={filters.status}
          onChange={(value) => updateFilter("status", value)}
        />
        <RangePicker
          showTime
          value={filters.createdRange ?? null}
          onChange={(value) =>
            updateFilter("createdRange", value?.[0] && value[1] ? [value[0], value[1]] : null)
          }
        />
        <Space className="logsFilterActions">
          <Button type="primary" onClick={() => void refresh(1, pagination.pageSize)}>
            查询
          </Button>
          <Button onClick={resetFilters}>重置</Button>
        </Space>
      </section>

      <section className="panel logsTablePanel">
        <Table<ToolCallLogListItem>
          columns={columns}
          dataSource={toolCallLogs}
          loading={loading}
          pagination={{
            current: pagination.page,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true
          }}
          rowKey="id"
          scroll={{ x: 1830 }}
          tableLayout="fixed"
          onChange={(nextPagination) => {
            void refresh(nextPagination.current || 1, nextPagination.pageSize || 20);
          }}
        />
      </section>

      <Drawer
        destroyOnClose
        open={Boolean(detailLog)}
        title="工具调用详情"
        width={640}
        onClose={() => setDetailLog(null)}
      >
        {detailLog ? <ToolCallLogDetail log={detailLog} /> : null}
      </Drawer>
    </section>
  );
}

function ToolCallLogDetail({ log }: { log: ToolCallLogListItem }) {
  const rows = [
    ["Agent ID", log.agentId],
    ["Request ID", log.requestId],
    ["Tool Call ID", log.toolCallId],
    ["工具 ID", log.toolId],
    ["状态", formatStatus(log.status)],
    ["来源", formatSource(log.source)],
    ["原因", log.reason],
    ["错误类型", log.errorType],
    ["错误信息", log.errorMessage],
    ["耗时", log.elapsedMs === null ? null : `${log.elapsedMs}ms`],
    ["创建时间", formatDate(log.createdAt)]
  ];

  return (
    <div className="logDetail">
      <div className="logDetailGrid">
        {rows.map(([label, value]) => (
          <div className="logDetailRow" key={label}>
            <span className="logDetailLabel">{label}</span>
            <span className="logDetailValue">{value || "-"}</span>
          </div>
        ))}
      </div>

      <section className="logDetailSection">
        <h2>输入参数</h2>
        <pre>{formatJson(log.input)}</pre>
      </section>

      <section className="logDetailSection">
        <h2>输出结果</h2>
        <pre>{formatJson(log.output)}</pre>
      </section>
    </div>
  );
}

function normalizeFilters(filters: LogFilters): ToolCallLogQuery {
  return {
    requestId: filters.requestId?.trim(),
    agentId: filters.agentId?.trim(),
    toolId: filters.toolId?.trim(),
    status: filters.status,
    createdFrom: filters.createdRange?.[0]?.toISOString(),
    createdTo: filters.createdRange?.[1]?.toISOString()
  };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatStatus(status: string): string {
  const labels: Record<string, string> = {
    available: "可用",
    requested: "请求",
    completed: "完成",
    failed: "失败",
    skipped: "跳过"
  };

  return labels[status] ?? status;
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    available: "blue",
    requested: "processing",
    completed: "green",
    failed: "red",
    skipped: "default"
  };

  return colors[status] ?? "default";
}

function formatSource(source: string | null): string {
  if (!source) {
    return "-";
  }

  const labels: Record<string, string> = {
    chat_start: "对话开始",
    model_native: "模型工具调用",
    text_json: "文本 JSON",
    inferred: "推断调用",
    model_response: "模型响应"
  };

  return labels[source] ?? source;
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
