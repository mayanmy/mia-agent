import { useCallback, useEffect, useMemo, useState } from "react";
import { StopOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Drawer, Empty, Progress, Select, Space, Spin, Table, Tag, message, type TableProps } from "antd";
import { useNavigate, useParams } from "react-router-dom";

import { WorkspacePageHeader } from "../../shared/components/WorkspacePageHeader";
import {
  cancelEvaluationRun,
  getEvaluationComparison,
  getEvaluationRun,
  listCompatibleEvaluationBaselines,
  listEvaluationRunResults,
  type EvaluationCaseResult,
  type EvaluationComparison,
  type EvaluationRun,
  type EvaluationRunDetail,
  type EvaluationRunStatus
} from "./api";
import "./evaluations.less";

const statusMeta: Record<EvaluationRunStatus, { label: string; color: string }> = {
  PENDING: { label: "等待执行", color: "default" }, RUNNING: { label: "运行中", color: "processing" },
  COMPLETED: { label: "已完成", color: "success" }, FAILED: { label: "失败", color: "error" }, CANCELED: { label: "已取消", color: "warning" }
};

export function EvaluationRunPage() {
  const { runId = "" } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState<EvaluationRunDetail | null>(null);
  const [results, setResults] = useState<EvaluationCaseResult[]>([]);
  const [baselines, setBaselines] = useState<EvaluationRun[]>([]);
  const [comparison, setComparison] = useState<EvaluationComparison | null>(null);
  const [selectedResult, setSelectedResult] = useState<EvaluationCaseResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [detail, resultPage] = await Promise.all([getEvaluationRun(runId), listEvaluationRunResults(runId)]);
      setRun(detail); setResults(resultPage.list);
      if (detail.status === "COMPLETED") setBaselines(await listCompatibleEvaluationBaselines(runId));
    } catch (error) { if (!quiet) message.error(error instanceof Error ? error.message : "评估报告加载失败"); }
    finally { if (!quiet) setLoading(false); }
  }, [runId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (run?.status !== "PENDING" && run?.status !== "RUNNING") return;
    const timer = window.setInterval(() => { if (!document.hidden) void load(true); }, 3000);
    return () => window.clearInterval(timer);
  }, [run?.status, load]);

  const columns = useMemo<TableProps<EvaluationCaseResult>["columns"]>(() => [
    { title: "状态", dataIndex: "status", width: 90, render: (value: EvaluationCaseResult["status"]) => <Tag>{caseStatus(value)}</Tag> },
    { title: "问题", render: (_, item) => <Button type="link" className="evaluationQuestionLink" onClick={() => setSelectedResult(item)}>{item.evaluationCase.question}</Button> },
    { title: "分类", width: 120, render: (_, item) => item.evaluationCase.category || "—" },
    { title: "命中", width: 90, render: (_, item) => formatPercent(item.retrievalMetrics?.hitRateAt5) },
    { title: "Recall@5", width: 100, render: (_, item) => formatPercent(item.retrievalMetrics?.recallAt5) },
    { title: "MRR", width: 80, render: (_, item) => formatDecimal(item.retrievalMetrics?.mrr) },
    { title: "总耗时", width: 100, render: (_, item) => item.runtimeMetrics?.totalMs == null ? "—" : `${item.runtimeMetrics.totalMs} ms` }
  ], []);

  if (loading) return <div className="workspace"><Spin /></div>;
  if (!run) return <div className="workspace"><Empty description="评估运行不存在" /></div>;
  const done = run.completedCases + run.failedCases + run.skippedCases;
  const active = run.status === "PENDING" || run.status === "RUNNING";

  return <section className="workspace evaluationWorkspace">
    <WorkspacePageHeader eyebrow="OPERATIONS / EVALUATION REPORT" title={`${run.dataset.name} · v${run.dataset.version}`} description={`Agent：${run.agentName}`} onBack={() => navigate("/operations/evaluations")} actions={active ? <Button danger icon={<StopOutlined />} onClick={async () => { await cancelEvaluationRun(run.id); message.success("已请求取消"); await load(); }}>取消运行</Button> : undefined} />
    <section className="panel evaluationRunHeader">
      <Space wrap><Tag color={statusMeta[run.status].color}>{statusMeta[run.status].label}</Tag><span>创建于 {new Date(run.createdAt).toLocaleString()}</span>{run.finishedAt && <span>完成于 {new Date(run.finishedAt).toLocaleString()}</span>}</Space>
      <Progress percent={run.totalCases ? Math.round(done / run.totalCases * 100) : 0} format={() => `${done}/${run.totalCases}`} />
      {run.errorMessage && <Alert type="error" showIcon message={run.errorType || "运行失败"} description={run.errorMessage} />}
    </section>

    <section aria-labelledby="metric-heading"><h2 id="metric-heading" className="evaluationSectionTitle">分层指标</h2><MetricGrid run={run} comparison={comparison} /></section>

    <section className="panel evaluationComparisonPanel" aria-labelledby="comparison-heading">
      <div><h2 id="comparison-heading">Baseline / Candidate 对比</h2><p>只列出相同冻结数据集和指标版本的已完成运行。</p></div>
      <Select allowClear showSearch optionFilterProp="label" placeholder="选择 Baseline" style={{ minWidth: 320 }} options={baselines.map((item) => ({ value: item.id, label: `${item.agentName} · ${new Date(item.createdAt).toLocaleString()}` }))} onChange={async (baselineId) => { if (!baselineId) return setComparison(null); try { setComparison(await getEvaluationComparison(baselineId, run.id)); } catch (error) { message.error(error instanceof Error ? error.message : "对比加载失败"); } }} />
      {comparison && <ComparisonTable comparison={comparison} />}
    </section>

    <section className="panel evaluationTablePanel" aria-labelledby="case-heading"><h2 id="case-heading" className="evaluationSectionTitle">用例结果</h2><Table rowKey="id" columns={columns} dataSource={results} pagination={{ pageSize: 20 }} scroll={{ x: 900 }} /></section>
    <ResultDrawer result={selectedResult} onClose={() => setSelectedResult(null)} />
  </section>;
}

function MetricGrid({ run, comparison }: { run: EvaluationRunDetail; comparison: EvaluationComparison | null }) {
  const cards = [
    { key: "retrieval.hitRateAt5", label: "HitRate@5", value: run.summaryMetrics?.retrieval?.hitRateAt5, percent: true },
    { key: "retrieval.recallAt5", label: "Recall@5", value: run.summaryMetrics?.retrieval?.recallAt5, percent: true },
    { key: "retrieval.mrr", label: "MRR", value: run.summaryMetrics?.retrieval?.mrr, percent: false },
    { key: "retrieval.emptyRetrievalRate", label: "空召回率", value: run.summaryMetrics?.retrieval?.emptyRetrievalRate, percent: true },
    { key: "runtime.successRate", label: "成功率", value: run.summaryMetrics?.runtime?.successRate, percent: true },
    { key: "runtime.p95TotalMs", label: "P95 总耗时", value: run.summaryMetrics?.runtime?.p95TotalMs, unit: "ms", percent: false }
  ];
  return <div className="evaluationMetricGrid">{cards.map((card) => {
    const delta = comparison?.metrics.find((item) => item.key === card.key);
    return <article className="panel evaluationMetricCard" key={card.key}><span>{card.label}</span><strong>{card.value == null ? "—" : card.percent ? formatPercent(card.value) : `${formatDecimal(card.value)}${card.unit ? ` ${card.unit}` : ""}`}</strong><small>{run.summaryMetrics?.sampleCount ?? 0}/{run.totalCases} 个有效样本{delta?.absoluteDelta == null ? "" : ` · Δ ${delta.absoluteDelta > 0 ? "+" : ""}${formatDecimal(delta.absoluteDelta)}`}</small></article>;
  })}</div>;
}

function ComparisonTable({ comparison }: { comparison: EvaluationComparison }) {
  if (!comparison.compatibility.compatible) return <Alert type="warning" showIcon message="运行不可比较" description={comparison.compatibility.reasons.map((item) => item.message).join("；")} />;
  return <div className="evaluationComparisonTable"><div className="evaluationCaseCounts"><span>改善 <strong>{comparison.caseCounts.improved}</strong></span><span>退化 <strong>{comparison.caseCounts.regressed}</strong></span><span>混合 <strong>{comparison.caseCounts.mixed}</strong></span><span>不变 <strong>{comparison.caseCounts.unchanged}</strong></span></div><Table size="small" pagination={false} rowKey="key" dataSource={comparison.metrics} columns={[
    { title: "指标", dataIndex: "label" }, { title: "方向", dataIndex: "direction", render: (value: string) => value === "higher_is_better" ? "越高越好" : "越低越好" },
    { title: "Baseline", dataIndex: "baselineValue", render: formatDecimal }, { title: "Candidate", dataIndex: "candidateValue", render: formatDecimal },
    { title: "变化", dataIndex: "absoluteDelta", render: (value: number | null, row) => value == null ? "—" : <Tag color={row.verdict === "improved" ? "success" : row.verdict === "regressed" ? "error" : "default"}>{value > 0 ? "+" : ""}{formatDecimal(value)} · {verdictLabel(row.verdict)}</Tag> }
  ]} /></div>;
}

function ResultDrawer({ result, onClose }: { result: EvaluationCaseResult | null; onClose: () => void }) {
  return <Drawer title="用例结果详情" width={720} open={Boolean(result)} onClose={onClose}>{result && <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <Descriptions column={2} bordered size="small"><Descriptions.Item label="状态">{caseStatus(result.status)}</Descriptions.Item><Descriptions.Item label="总耗时">{result.runtimeMetrics?.totalMs ?? "—"} ms</Descriptions.Item><Descriptions.Item label="Recall@5">{formatPercent(result.retrievalMetrics?.recallAt5)}</Descriptions.Item><Descriptions.Item label="MRR">{formatDecimal(result.retrievalMetrics?.mrr)}</Descriptions.Item></Descriptions>
    <section><h3>问题</h3><p className="evaluationLongText">{result.evaluationCase.question}</p></section>
    <section><h3>期望答案</h3><p className="evaluationLongText">{result.evaluationCase.expectedAnswer || "未标注"}</p></section>
    <section><h3>实际答案</h3><p className="evaluationLongText">{result.actualAnswer || result.errorMessage || "尚未生成"}</p></section>
    <section><h3>检索片段</h3>{result.retrievedChunks?.length ? result.retrievedChunks.map((chunk, index) => <article className="evaluationChunk" key={chunk.chunkId}><strong>[{index + 1}] {chunk.documentName}</strong><span>相关度 {formatDecimal(chunk.score)}</span><p>{chunk.content}</p></article>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有检索片段" />}</section>
  </Space>}</Drawer>;
}

function formatPercent(value: number | null | undefined) { return value == null ? "—" : `${(value * 100).toFixed(1)}%`; }
function formatDecimal(value: number | null | undefined) { return value == null ? "—" : Math.abs(value) >= 100 ? Math.round(value).toLocaleString() : value.toFixed(3); }
function caseStatus(value: EvaluationCaseResult["status"]) { return ({ PENDING: "等待", RUNNING: "执行中", COMPLETED: "完成", FAILED: "失败", SKIPPED: "跳过" } as const)[value]; }
function verdictLabel(value: EvaluationComparison["metrics"][number]["verdict"]) { return ({ improved: "改善", regressed: "退化", unchanged: "不变", not_comparable: "不可比较" } as const)[value]; }
