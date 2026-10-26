import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  StopOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Progress,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  message,
  type TableProps
} from "antd";
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
  PENDING: { label: "等待执行", color: "default" },
  RUNNING: { label: "运行中", color: "processing" },
  COMPLETED: { label: "已完成", color: "success" },
  FAILED: { label: "失败", color: "error" },
  CANCELED: { label: "已取消", color: "warning" }
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

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const [detail, resultPage] = await Promise.all([
          getEvaluationRun(runId),
          listEvaluationRunResults(runId)
        ]);
        setRun(detail);
        setResults(resultPage.list);
        if (detail.status === "COMPLETED")
          setBaselines(await listCompatibleEvaluationBaselines(runId));
      } catch (error) {
        if (!quiet) message.error(error instanceof Error ? error.message : "评估报告加载失败");
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [runId]
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (run?.status !== "PENDING" && run?.status !== "RUNNING") return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [run?.status, load]);

  const columns = useMemo<TableProps<EvaluationCaseResult>["columns"]>(
    () => [
      {
        title: "状态",
        dataIndex: "status",
        width: 90,
        render: (value: EvaluationCaseResult["status"]) => <Tag>{caseStatus(value)}</Tag>
      },
      {
        title: "问题",
        render: (_, item) => (
          <Button
            type="link"
            className="evaluationQuestionLink"
            onClick={() => setSelectedResult(item)}
          >
            {item.evaluationCase.question}
          </Button>
        )
      },
      { title: "分类", width: 120, render: (_, item) => item.evaluationCase.category || "—" },
      {
        title: "命中",
        width: 90,
        render: (_, item) => formatPercent(item.retrievalMetrics?.hitRateAt5)
      },
      {
        title: "Recall@5",
        width: 100,
        render: (_, item) => formatPercent(item.retrievalMetrics?.recallAt5)
      },
      { title: "MRR", width: 80, render: (_, item) => formatDecimal(item.retrievalMetrics?.mrr) },
      {
        title: "答案质量",
        width: 100,
        render: (_, item) => formatPercent(averageScore(item.answerMetrics))
      },
      {
        title: "总耗时",
        width: 100,
        render: (_, item) =>
          item.runtimeMetrics?.totalMs == null ? "—" : `${item.runtimeMetrics.totalMs} ms`
      }
    ],
    []
  );

  if (loading)
    return (
      <div className="workspace">
        <Spin />
      </div>
    );
  if (!run)
    return (
      <div className="workspace">
        <Empty description="评估运行不存在" />
      </div>
    );
  const done = run.completedCases + run.failedCases + run.skippedCases;
  const active = run.status === "PENDING" || run.status === "RUNNING";

  const progress = run.totalCases ? Math.round((done / run.totalCases) * 100) : 0;

  return (
    <section className="workspace evaluationWorkspace">
      <WorkspacePageHeader
        title={`${run.dataset.name} · v${run.dataset.version}`}
        description={
          <>
            由 <strong>{run.agentName}</strong> 执行 · 使用冻结配置快照
          </>
        }
        meta={<Tag color={statusMeta[run.status].color}>{statusMeta[run.status].label}</Tag>}
        onBack={() => navigate("/operations/evaluations")}
        actions={
          active ? (
            <Button
              danger
              icon={<StopOutlined />}
              onClick={async () => {
                await cancelEvaluationRun(run.id);
                message.success("已请求取消");
                await load();
              }}
            >
              取消运行
            </Button>
          ) : undefined
        }
      />

      <section className="panel evaluationRunSummary" aria-label="运行概况">
        <div className="evaluationRunSummaryMain">
          <div>
            <span className="evaluationSummaryEyebrow">运行进度</span>
            <strong>
              {done}
              <small> / {run.totalCases} 个用例</small>
            </strong>
          </div>
          <Progress
            aria-label={`已完成 ${done} 个，共 ${run.totalCases} 个`}
            percent={progress}
            showInfo={false}
            status={run.status === "FAILED" ? "exception" : active ? "active" : "success"}
          />
        </div>
        <dl className="evaluationRunFacts">
          <div>
            <dt>
              <ClockCircleOutlined aria-hidden="true" />
              创建时间
            </dt>
            <dd>{formatDateTime(run.createdAt)}</dd>
          </div>
          <div>
            <dt>
              <CheckCircleOutlined aria-hidden="true" />
              完成时间
            </dt>
            <dd>{run.finishedAt ? formatDateTime(run.finishedAt) : "尚未完成"}</dd>
          </div>
          <div>
            <dt>
              <ExperimentOutlined aria-hidden="true" />
              有效样本
            </dt>
            <dd>
              {run.summaryMetrics?.sampleCount ?? run.completedCases} / {run.totalCases}
            </dd>
          </div>
        </dl>
        {run.errorMessage && (
          <Alert
            type="error"
            showIcon
            message={run.errorType || "运行失败"}
            description={run.errorMessage}
          />
        )}
      </section>

      <section aria-labelledby="metric-heading">
        <SectionHeading
          id="metric-heading"
          title="评估指标"
          description="检索质量、答案质量、运行表现与成本分组展示，便于快速定位回归来源。"
        />
        <MetricGrid run={run} comparison={comparison} />
      </section>

      <section className="panel evaluationComparisonPanel" aria-labelledby="comparison-heading">
        <div className="evaluationPanelHeader">
          <SectionHeading
            id="comparison-heading"
            title="Baseline / Candidate 对比"
            description="仅比较相同冻结数据集及指标版本的已完成运行。"
          />
          <Select
            aria-label="选择 Baseline 运行"
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={baselines.length ? "选择 Baseline" : "暂无可比较运行"}
            disabled={!baselines.length}
            className="evaluationBaselineSelect"
            options={baselines.map((item) => ({
              value: item.id,
              label: `${item.agentName} · ${formatDateTime(item.createdAt)}`
            }))}
            onChange={async (baselineId) => {
              if (!baselineId) return setComparison(null);
              try {
                setComparison(await getEvaluationComparison(baselineId, run.id));
              } catch (error) {
                message.error(error instanceof Error ? error.message : "对比加载失败");
              }
            }}
          />
        </div>
        {comparison ? (
          <ComparisonTable comparison={comparison} />
        ) : (
          <div className="evaluationComparisonEmpty">
            <DatabaseOutlined aria-hidden="true" />
            <span>
              {baselines.length
                ? "选择一次历史运行，查看指标变化与用例回归。"
                : "完成第二次同数据集评估后，即可在这里生成回归对比。"}
            </span>
          </div>
        )}
      </section>

      <section className="panel evaluationTablePanel" aria-labelledby="case-heading">
        <div className="evaluationTableHeader">
          <SectionHeading
            id="case-heading"
            title="用例结果"
            description={`${results.length} 条结果，点击问题查看答案与检索片段。`}
          />
          <div className="evaluationResultLegend" aria-label="用例结果统计">
            <span>
              <i className="is-success" />
              完成 {run.completedCases}
            </span>
            <span>
              <i className="is-danger" />
              失败 {run.failedCases}
            </span>
            <span>
              <i className="is-muted" />
              跳过 {run.skippedCases}
            </span>
          </div>
        </div>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={results}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 900 }}
        />
      </section>
      <ResultDrawer result={selectedResult} onClose={() => setSelectedResult(null)} />
    </section>
  );
}

function MetricGrid({
  run,
  comparison
}: {
  run: EvaluationRunDetail;
  comparison: EvaluationComparison | null;
}) {
  const cards = [
    {
      key: "retrieval.hitRateAt5",
      group: "检索质量",
      label: "HitRate@5",
      hint: "前 5 条中至少命中一条",
      value: run.summaryMetrics?.retrieval?.hitRateAt5,
      percent: true
    },
    {
      key: "retrieval.recallAt5",
      group: "检索质量",
      label: "Recall@5",
      hint: "期望内容被召回的比例",
      value: run.summaryMetrics?.retrieval?.recallAt5,
      percent: true
    },
    {
      key: "retrieval.mrr",
      group: "检索质量",
      label: "MRR",
      hint: "首个正确结果的排序质量",
      value: run.summaryMetrics?.retrieval?.mrr,
      percent: false
    },
    {
      key: "retrieval.emptyRetrievalRate",
      group: "检索质量",
      label: "空召回率",
      hint: "未检索到任何片段的比例",
      value: run.summaryMetrics?.retrieval?.emptyRetrievalRate,
      percent: true
    },
    {
      key: "answer.correctness",
      group: "答案质量",
      label: "答案正确性",
      hint: "相对参考答案的正确与完整程度",
      value: run.summaryMetrics?.answer?.correctness,
      percent: true
    },
    {
      key: "answer.faithfulness",
      group: "答案质量",
      label: "忠实度",
      hint: "回答陈述可由检索上下文支持",
      value: run.summaryMetrics?.answer?.faithfulness,
      percent: true
    },
    {
      key: "answer.relevance",
      group: "答案质量",
      label: "答案相关性",
      hint: "回答是否直接响应用户问题",
      value: run.summaryMetrics?.answer?.relevance,
      percent: true
    },
    {
      key: "runtime.successRate",
      group: "运行表现",
      label: "成功率",
      hint: "成功生成答案的用例比例",
      value: run.summaryMetrics?.runtime?.successRate,
      percent: true
    },
    {
      key: "runtime.p95TotalMs",
      group: "运行表现",
      label: "P95 总耗时",
      hint: "95% 用例在此时间内完成",
      value: run.summaryMetrics?.runtime?.p95TotalMs,
      duration: true,
      percent: false
    },
    {
      key: "runtime.totalTokens",
      group: "成本与用量",
      label: "总 Token",
      hint: "被测模型与 Judge 的 Token 总量",
      value: run.summaryMetrics?.runtime?.totalTokens,
      integer: true,
      percent: false
    },
    {
      key: "runtime.totalCostMicros",
      group: "成本与用量",
      label: "估算总成本",
      hint: "按运行创建时的模型价格快照估算",
      value: run.summaryMetrics?.runtime?.totalCostMicros,
      cost: true,
      currency: run.summaryMetrics?.runtime?.currency,
      percent: false
    }
  ];
  return (
    <div className="evaluationMetricGrid">
      {cards.map((card) => {
        const delta = comparison?.metrics.find((item) => item.key === card.key);
        const value =
          card.value == null
            ? "未采集"
            : card.cost
              ? formatCost(card.value, card.currency)
              : card.duration
                ? formatDuration(card.value)
                : card.integer
                  ? Math.round(card.value).toLocaleString()
                  : card.percent
                    ? formatPercent(card.value)
                    : formatDecimal(card.value);
        return (
          <article className="panel evaluationMetricCard" key={card.key}>
            <div className="evaluationMetricMeta">
              <span>{card.group}</span>
              {delta?.absoluteDelta != null && (
                <Tag
                  color={
                    delta.verdict === "improved"
                      ? "success"
                      : delta.verdict === "regressed"
                        ? "error"
                        : "default"
                  }
                >
                  {verdictLabel(delta.verdict)}
                </Tag>
              )}
            </div>
            <div>
              <h3>{card.label}</h3>
              <p>{card.hint}</p>
            </div>
            <strong>{value}</strong>
            <small>
              {card.value == null
                ? "该运行未启用或缺少配置"
                : `${run.summaryMetrics?.sampleCount ?? 0}/${run.totalCases} 个有效样本${card.duration ? ` · ${Math.round(card.value).toLocaleString()} ms` : ""}`}
            </small>
          </article>
        );
      })}
    </div>
  );
}

function SectionHeading({
  id,
  title,
  description
}: {
  id: string;
  title: string;
  description: string;
}) {
  return (
    <div className="evaluationSectionHeading">
      <h2 id={id}>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function ComparisonTable({ comparison }: { comparison: EvaluationComparison }) {
  if (!comparison.compatibility.compatible)
    return (
      <Alert
        type="warning"
        showIcon
        message="运行不可比较"
        description={comparison.compatibility.reasons.map((item) => item.message).join("；")}
      />
    );
  return (
    <div className="evaluationComparisonTable">
      <div className="evaluationCaseCounts">
        <span>
          改善 <strong>{comparison.caseCounts.improved}</strong>
        </span>
        <span>
          退化 <strong>{comparison.caseCounts.regressed}</strong>
        </span>
        <span>
          混合 <strong>{comparison.caseCounts.mixed}</strong>
        </span>
        <span>
          不变 <strong>{comparison.caseCounts.unchanged}</strong>
        </span>
      </div>
      <Table
        size="small"
        pagination={false}
        rowKey="key"
        dataSource={comparison.metrics}
        columns={[
          { title: "指标", dataIndex: "label" },
          {
            title: "方向",
            dataIndex: "direction",
            render: (value: string) => (value === "higher_is_better" ? "越高越好" : "越低越好")
          },
          { title: "Baseline", dataIndex: "baselineValue", render: formatDecimal },
          { title: "Candidate", dataIndex: "candidateValue", render: formatDecimal },
          {
            title: "变化",
            dataIndex: "absoluteDelta",
            render: (value: number | null, row) =>
              value == null ? (
                "—"
              ) : (
                <Tag
                  color={
                    row.verdict === "improved"
                      ? "success"
                      : row.verdict === "regressed"
                        ? "error"
                        : "default"
                  }
                >
                  {value > 0 ? "+" : ""}
                  {formatDecimal(value)} · {verdictLabel(row.verdict)}
                </Tag>
              )
          }
        ]}
      />
    </div>
  );
}

function ResultDrawer({
  result,
  onClose
}: {
  result: EvaluationCaseResult | null;
  onClose: () => void;
}) {
  return (
    <Drawer title="用例结果详情" width={720} open={Boolean(result)} onClose={onClose}>
      {result && (
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="状态">{caseStatus(result.status)}</Descriptions.Item>
            <Descriptions.Item label="总耗时">
              {result.runtimeMetrics?.totalMs == null ? "—" : `${result.runtimeMetrics.totalMs} ms`}
            </Descriptions.Item>
            <Descriptions.Item label="Recall@5">
              {formatPercent(result.retrievalMetrics?.recallAt5)}
            </Descriptions.Item>
            <Descriptions.Item label="MRR">
              {formatDecimal(result.retrievalMetrics?.mrr)}
            </Descriptions.Item>
            <Descriptions.Item label="总 Token">
              {result.runtimeMetrics?.agentUsage || result.runtimeMetrics?.graderUsage
                ? (
                    (result.runtimeMetrics.agentUsage?.totalTokens ?? 0) +
                    (result.runtimeMetrics.graderUsage?.totalTokens ?? 0)
                  ).toLocaleString()
                : "未采集"}
            </Descriptions.Item>
            <Descriptions.Item label="估算成本">
              {result.runtimeMetrics?.estimatedCostMicros == null
                ? "未配置价格"
                : formatCost(
                    result.runtimeMetrics.estimatedCostMicros,
                    result.runtimeMetrics.currency
                  )}
            </Descriptions.Item>
          </Descriptions>
          <section>
            <h3>问题</h3>
            <p className="evaluationLongText">{result.evaluationCase.question}</p>
          </section>
          <section>
            <h3>期望答案</h3>
            <p className="evaluationLongText">{result.evaluationCase.expectedAnswer || "未标注"}</p>
          </section>
          <section>
            <h3>实际答案</h3>
            <p className="evaluationLongText">
              {result.actualAnswer || result.errorMessage || "尚未生成"}
            </p>
          </section>
          <JudgeDetails result={result} />
          <section>
            <h3>检索片段</h3>
            {result.retrievedChunks?.length ? (
              result.retrievedChunks.map((chunk, index) => (
                <article className="evaluationChunk" key={chunk.chunkId}>
                  <strong>
                    [{index + 1}] {chunk.documentName}
                  </strong>
                  <span>相关度 {formatDecimal(chunk.score)}</span>
                  <p>{chunk.content}</p>
                </article>
              ))
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有检索片段" />
            )}
          </section>
        </Space>
      )}
    </Drawer>
  );
}

function JudgeDetails({ result }: { result: EvaluationCaseResult }) {
  const details = result.graderDetails;
  if (!details)
    return (
      <section>
        <h3>LLM Judge</h3>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本次运行未启用答案质量评估" />
      </section>
    );
  if (!details.metrics)
    return (
      <Alert
        type="warning"
        showIcon
        message="Judge 指标未采集"
        description={details.warning || "裁判模型未返回有效结构化结果"}
      />
    );
  const labels = {
    correctness: "答案正确性",
    faithfulness: "忠实度",
    relevance: "答案相关性"
  } as const;
  return (
    <section>
      <h3>LLM Judge</h3>
      <div className="evaluationJudgeGrid">
        {Object.entries(details.metrics).map(([key, metric]) => (
          <article className="evaluationJudgeCard" key={key}>
            <div>
              <strong>{labels[key as keyof typeof labels]}</strong>
              <Tag color={metric.passed ? "success" : "error"}>
                {metric.passed ? "通过" : "未通过"}
              </Tag>
            </div>
            <b>{formatPercent(metric.score)}</b>
            <p>{metric.reason}</p>
            {metric.failureType && <small>失败类型：{metric.failureType}</small>}
            {metric.evidence.length > 0 && (
              <ul>
                {metric.evidence.map((evidence) => (
                  <li key={evidence}>{evidence}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function formatPercent(value: number | null | undefined) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}
function formatDecimal(value: number | null | undefined) {
  return value == null
    ? "—"
    : Math.abs(value) >= 100
      ? Math.round(value).toLocaleString()
      : value.toFixed(3);
}
function formatDuration(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}
function formatCost(valueMicros: number, currency: string | null | undefined) {
  return `${currency || ""} ${(valueMicros / 1_000_000).toFixed(6)}`.trim();
}
function averageScore(value: EvaluationCaseResult["answerMetrics"]) {
  return value ? (value.correctness + value.faithfulness + value.relevance) / 3 : null;
}
function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { hour12: false });
}
function caseStatus(value: EvaluationCaseResult["status"]) {
  return (
    {
      PENDING: "等待",
      RUNNING: "执行中",
      COMPLETED: "完成",
      FAILED: "失败",
      SKIPPED: "跳过"
    } as const
  )[value];
}
function verdictLabel(value: EvaluationComparison["metrics"][number]["verdict"]) {
  return (
    { improved: "改善", regressed: "退化", unchanged: "不变", not_comparable: "不可比较" } as const
  )[value];
}
