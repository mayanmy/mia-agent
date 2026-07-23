import { useEffect, useState } from "react";
import { ReloadOutlined } from "@ant-design/icons";
import { Button, DatePicker, Drawer, Input, Select, Space, Spin, Table, Tag, Timeline, Typography, message } from "antd";
import type { Dayjs } from "dayjs";
import type { TableProps } from "antd";

import { getAgentRunDetail, listAgentRuns, type AgentRunDetail, type AgentRunListItem, type AgentRunQuery } from "./api";
import "./agent-runs.less";

const { RangePicker } = DatePicker;
type Filters = Omit<AgentRunQuery, "page" | "pageSize" | "createdFrom" | "createdTo"> & { range?: [Dayjs, Dayjs] | null };

const statusOptions = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELED", "TIMED_OUT"].map((value) => ({ label: value, value }));
const sourceOptions = ["INTERNAL_CHAT", "PUBLIC_WIDGET", "SERVICE_API", "ASYNC_TASK"].map((value) => ({ label: value, value }));

export function AgentRunsPage() {
  const [runs, setRuns] = useState<AgentRunListItem[]>([]);
  const [filters, setFilters] = useState<Filters>({});
  const [paging, setPaging] = useState({ page: 1, pageSize: 20, total: 0 });
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<AgentRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => { void refresh(1, 20, {}); }, []);

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

  /** 详情按需加载，列表接口只返回排查所需摘要。 */
  async function openDetail(runId: string) {
    setDetailLoading(true);
    try {
      setDetail(await getAgentRunDetail(runId));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载 Run 详情失败");
    } finally {
      setDetailLoading(false);
    }
  }

  const columns: TableProps<AgentRunListItem>["columns"] = [
    { title: "时间", dataIndex: "createdAt", width: 170, render: formatDate },
    { title: "状态", dataIndex: "status", width: 110, render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag> },
    { title: "来源", dataIndex: "source", width: 140 },
    { title: "输入", dataIndex: "inputPreview", width: 280, ellipsis: true },
    { title: "Agent ID", dataIndex: "agentId", width: 220, render: (value: string) => <Typography.Text copyable className="runMono">{value}</Typography.Text> },
    { title: "步骤", dataIndex: "stepCount", width: 80 },
    { title: "耗时", width: 100, render: (_, run) => formatDuration(run.startedAt, run.finishedAt) },
    { title: "错误", dataIndex: "errorType", width: 170, render: (value: string | null) => value || "-" },
    { title: "Request ID", dataIndex: "requestId", width: 220, render: (value: string) => <Typography.Text copyable className="runMono">{value}</Typography.Text> },
    { title: "操作", fixed: "right", width: 90, render: (_, run) => <Button type="link" size="small" onClick={() => void openDetail(run.id)}>详情</Button> }
  ];

  return <section className="workspace runWorkspace">
    <header className="compactPageHeader"><div><h1>Run Trace</h1><p>查看 Agent 执行状态、阶段耗时和失败上下文。</p></div><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>刷新</Button></header>
    <section className="panel runFilters">
      <Input allowClear placeholder="Request ID" value={filters.requestId} onChange={(e) => setFilters({ ...filters, requestId: e.target.value })} />
      <Input allowClear placeholder="Agent ID" value={filters.agentId} onChange={(e) => setFilters({ ...filters, agentId: e.target.value })} />
      <Select allowClear placeholder="状态" options={statusOptions} value={filters.status} onChange={(status) => setFilters({ ...filters, status })} />
      <Select allowClear placeholder="来源" options={sourceOptions} value={filters.source} onChange={(source) => setFilters({ ...filters, source })} />
      <RangePicker showTime value={filters.range ?? null} onChange={(value) => setFilters({ ...filters, range: value?.[0] && value[1] ? [value[0], value[1]] : null })} />
      <Space><Button type="primary" onClick={() => void refresh(1, paging.pageSize)}>查询</Button><Button onClick={() => { setFilters({}); void refresh(1, paging.pageSize, {}); }}>重置</Button></Space>
    </section>
    <section className="panel runTable"><Table columns={columns} dataSource={runs} loading={loading} rowKey="id" tableLayout="fixed" scroll={{ x: 1550 }} pagination={{ current: paging.page, pageSize: paging.pageSize, total: paging.total, showSizeChanger: true }} onChange={(next) => void refresh(next.current || 1, next.pageSize || 20)} /></section>
    <Drawer destroyOnClose width={760} title="Run Trace 详情" open={detailLoading || Boolean(detail)} onClose={() => setDetail(null)}>{detailLoading && !detail ? <Spin /> : detail ? <RunDetail detail={detail} /> : null}</Drawer>
  </section>;
}

/** 将 Run 和 Step 组织为可扫描的摘要与时间线。 */
function RunDetail({ detail }: { detail: AgentRunDetail }) {
  return <div className="runDetail">
    <div className="runSummary">{[["Run ID", detail.id], ["Request ID", detail.requestId], ["状态", detail.status], ["来源", detail.source], ["Agent ID", detail.agentId], ["模型配置", detail.modelConfigId], ["总耗时", formatDuration(detail.startedAt, detail.finishedAt)], ["首 Token", formatDuration(detail.startedAt, detail.firstTokenAt)], ["Token", `${detail.inputTokens ?? "-"} / ${detail.outputTokens ?? "-"}`], ["错误", detail.errorType ? `${detail.errorType}: ${detail.errorMessage ?? ""}` : "-"]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || "-"}</strong></div>)}</div>
    <TraceBlock title="输入" value={detail.inputPreview} />
    <TraceBlock title="输出" value={detail.outputPreview} />
    <h2>Timeline</h2>
    <Timeline items={detail.steps.map((step) => ({ color: statusColor(step.status), children: <article className="runStep"><header><strong>#{step.sequence} {step.type} · {step.name}</strong><Tag color={statusColor(step.status)}>{step.status}</Tag><span>{step.elapsedMs === null ? "-" : `${step.elapsedMs}ms`}</span></header>{step.errorType ? <p className="runError">{step.errorType}: {step.errorMessage}</p> : null}<TraceBlock title="Input" value={step.input} /><TraceBlock title="Output" value={step.output} /></article> }))} />
  </div>;
}

/** JSON 值使用预格式化文本展示，避免对象被隐式转成不可读字符串。 */
function TraceBlock({ title, value }: { title: string; value: unknown }) { if (value == null || value === "") return null; return <section className="traceBlock"><h3>{title}</h3><pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre></section>; }
function normalizeFilters(filters: Filters): AgentRunQuery { return { requestId: filters.requestId?.trim(), agentId: filters.agentId?.trim(), userId: filters.userId?.trim(), status: filters.status, source: filters.source, createdFrom: filters.range?.[0].toISOString(), createdTo: filters.range?.[1].toISOString() }; }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-"; }
function formatDuration(start: string | null, end: string | null) { if (!start || !end) return "-"; return `${Math.max(0, new Date(end).getTime() - new Date(start).getTime())}ms`; }
function statusColor(status: string) { if (status === "COMPLETED") return "green"; if (status === "RUNNING") return "blue"; if (status === "FAILED" || status === "TIMED_OUT") return "red"; if (status === "CANCELED") return "orange"; return "default"; }
