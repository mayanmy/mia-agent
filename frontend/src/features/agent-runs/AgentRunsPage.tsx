import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ReloadOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  DatePicker,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from "antd";
import type { Dayjs } from "dayjs";
import type { TableProps } from "antd";

import { WorkspacePageHeader } from "../../shared/components/WorkspacePageHeader";
import { AgentRunDetailDrawer } from "./components/AgentRunDetailDrawer";

import {
  listAgentRuns,
  type AgentRunListItem,
  type AgentRunQuery
} from "./api";
import "./agent-runs.less";

const { RangePicker } = DatePicker;
type Filters = Omit<AgentRunQuery, "page" | "pageSize" | "createdFrom" | "createdTo"> & {
  range?: [Dayjs, Dayjs] | null;
};

const statusOptions = [
  "QUEUED",
  "RUNNING",
  "WAITING_APPROVAL",
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "TIMED_OUT"
].map((value) => ({ label: value, value }));
const sourceOptions = [
  "INTERNAL_CHAT",
  "PUBLIC_WIDGET",
  "SERVICE_API",
  "ASYNC_TASK",
  "WORKFLOW_APP"
].map((value) => ({ label: value, value }));

export function AgentRunsPage() {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedRunId = searchParams.get("runId")?.trim() || undefined;
  const [runs, setRuns] = useState<AgentRunListItem[]>([]);
  const [filters, setFilters] = useState<Filters>({});
  const [paging, setPaging] = useState({ page: 1, pageSize: 20, total: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void refresh(1, 20, {});
  }, [linkedRunId]);

  /** 请求服务端分页数据，避免把大量 Trace 一次载入浏览器。 */
  async function refresh(page = paging.page, pageSize = paging.pageSize, nextFilters = filters) {
    setLoading(true);
    try {
      const result = await listAgentRuns({ ...normalizeFilters(nextFilters), page, pageSize });
      setRuns(result.list);
      setPaging({ page: result.page, pageSize: result.pageSize, total: result.total });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载 Run Trace 失败");
    } finally {
      setLoading(false);
    }
  }

  function openLinkedDetail(runId: string) {
    const next = new URLSearchParams(searchParams);
    next.set("runId", runId);
    setSearchParams(next);
  }

  function closeDetail() {
    const next = new URLSearchParams(searchParams);
    next.delete("runId");
    setSearchParams(next, { replace: true });
  }

  const columns: TableProps<AgentRunListItem>["columns"] = [
    { title: "时间", dataIndex: "createdAt", width: 170, render: formatDate },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag>
    },
    { title: "来源", dataIndex: "source", width: 140 },
    {
      title: "执行",
      width: 110,
      render: (_, run) => (
        <Tag color={run.workflowVersionId ? "cyan" : "default"}>
          {run.workflowVersionId ? "Workflow" : "Agent Loop"}
        </Tag>
      )
    },
    { title: "输入", dataIndex: "inputPreview", width: 280, ellipsis: true },
    {
      title: "Agent ID",
      dataIndex: "agentId",
      width: 220,
      render: (value: string) => (
        <Typography.Text copyable className="runMono">
          {value}
        </Typography.Text>
      )
    },
    { title: "步骤", dataIndex: "stepCount", width: 80 },
    {
      title: "耗时",
      width: 100,
      render: (_, run) => formatDuration(run.startedAt, run.finishedAt)
    },
    {
      title: "错误",
      dataIndex: "errorType",
      width: 170,
      render: (value: string | null) => value || "-"
    },
    {
      title: "Request ID",
      dataIndex: "requestId",
      width: 220,
      render: (value: string) => (
        <Typography.Text copyable className="runMono">
          {value}
        </Typography.Text>
      )
    },
    {
      title: "操作",
      fixed: "right",
      width: 90,
      render: (_, run) => (
        <Button type="link" size="small" onClick={() => openLinkedDetail(run.id)}>
          详情
        </Button>
      )
    }
  ];

  return (
    <section className="workspace runWorkspace">
      <WorkspacePageHeader
        actions={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>
            刷新
          </Button>
        }
        description="查看 Agent 执行状态、阶段耗时和失败上下文。"
        title="Run Trace"
      />
      <section className="panel runFilters">
        <Input
          allowClear
          placeholder="Request ID"
          value={filters.requestId}
          onChange={(e) => setFilters({ ...filters, requestId: e.target.value })}
        />
        <Input
          allowClear
          placeholder="Agent ID"
          value={filters.agentId}
          onChange={(e) => setFilters({ ...filters, agentId: e.target.value })}
        />
        <Select
          allowClear
          placeholder="状态"
          options={statusOptions}
          value={filters.status}
          onChange={(status) => setFilters({ ...filters, status })}
        />
        <Select
          allowClear
          placeholder="来源"
          options={sourceOptions}
          value={filters.source}
          onChange={(source) => setFilters({ ...filters, source })}
        />
        <RangePicker
          className="runFilterRange"
          showTime
          value={filters.range ?? null}
          onChange={(value) =>
            setFilters({ ...filters, range: value?.[0] && value[1] ? [value[0], value[1]] : null })
          }
        />
        <Space className="runFilterActions">
          <Button type="primary" onClick={() => void refresh(1, paging.pageSize)}>
            查询
          </Button>
          <Button
            onClick={() => {
              setFilters({});
              void refresh(1, paging.pageSize, {});
            }}
          >
            重置
          </Button>
        </Space>
      </section>
      <section className="panel runTable">
        <Table
          columns={columns}
          dataSource={runs}
          loading={loading}
          rowKey="id"
          tableLayout="fixed"
          scroll={{ x: 1550 }}
          pagination={{
            current: paging.page,
            pageSize: paging.pageSize,
            total: paging.total,
            showSizeChanger: true
          }}
          onChange={(next) => void refresh(next.current || 1, next.pageSize || 20)}
        />
      </section>
      <AgentRunDetailDrawer
        runId={linkedRunId ?? null}
        onClose={closeDetail}
        onOpenLogs={(detail) =>
          navigate(
            `/operations/logs?requestId=${encodeURIComponent(detail.requestId)}&runId=${encodeURIComponent(detail.id)}`
          )
        }
      />
    </section>
  );
}
function normalizeFilters(filters: Filters): AgentRunQuery {
  return {
    requestId: filters.requestId?.trim(),
    agentId: filters.agentId?.trim(),
    userId: filters.userId?.trim(),
    status: filters.status,
    source: filters.source,
    createdFrom: filters.range?.[0].toISOString(),
    createdTo: filters.range?.[1].toISOString()
  };
}
function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}
function formatDuration(start: string | null, end: string | null) {
  if (!start || !end) return "-";
  return `${Math.max(0, new Date(end).getTime() - new Date(start).getTime())}ms`;
}
function statusColor(status: string) {
  if (status === "COMPLETED") return "green";
  if (status === "RUNNING") return "blue";
  if (status === "FAILED" || status === "TIMED_OUT") return "red";
  if (status === "WAITING_APPROVAL") return "gold";
  if (status === "CANCELED") return "orange";
  return "default";
}
