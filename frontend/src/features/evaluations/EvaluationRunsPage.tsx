import { useCallback, useEffect, useMemo, useState } from "react";
import { PlusOutlined, StopOutlined } from "@ant-design/icons";
import {
  Button,
  Drawer,
  Form,
  InputNumber,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  message,
  type TableProps
} from "antd";

import { listAgents, type AgentListItem } from "../agents/api";
import { listModelConfigs, type ModelConfigListItem } from "../model-providers/api";
import { WorkspacePageHeader } from "../../shared/components/WorkspacePageHeader";
import { useNavigate } from "react-router-dom";
import {
  cancelEvaluationRun,
  createEvaluationRun,
  getEvaluationDataset,
  listEvaluationDatasets,
  listEvaluationRuns,
  type EvaluationRun,
  type EvaluationRunStatus
} from "./api";
import "./evaluations.less";

type CreateRunForm = {
  datasetVersionId: string;
  agentId: string;
  topK: number;
  scoreThreshold?: number;
  graderModelConfigId?: string;
};
type FrozenOption = { value: string; label: string; caseCount: number };

const statusMeta: Record<EvaluationRunStatus, { label: string; color: string }> = {
  PENDING: { label: "等待执行", color: "default" },
  RUNNING: { label: "运行中", color: "processing" },
  COMPLETED: { label: "已完成", color: "success" },
  FAILED: { label: "失败", color: "error" },
  CANCELED: { label: "已取消", color: "warning" }
};

export function EvaluationRunsPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm<CreateRunForm>();
  const [rows, setRows] = useState<EvaluationRun[]>([]);
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [versions, setVersions] = useState<FrozenOption[]>([]);
  const [graderModels, setGraderModels] = useState<ModelConfigListItem[]>([]);
  const [status, setStatus] = useState<EvaluationRunStatus | undefined>();
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadRuns = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const result = await listEvaluationRuns({ page: 1, pageSize: 50, status });
        setRows(result.list);
      } catch (error) {
        if (!quiet) message.error(error instanceof Error ? error.message : "评估运行加载失败");
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [status]
  );

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);
  useEffect(() => {
    if (!rows.some((row) => row.status === "PENDING" || row.status === "RUNNING")) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadRuns(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [rows, loadRuns]);

  async function openCreateDrawer() {
    setDrawerOpen(true);
    form.setFieldsValue({ topK: 5 });
    try {
      const [agentPage, datasetPage, modelPage] = await Promise.all([
        listAgents(1, 100),
        listEvaluationDatasets({ page: 1, pageSize: 100, status: "ACTIVE" }),
        listModelConfigs(1, 100)
      ]);
      setAgents(agentPage.list.filter((agent) => agent.enabled));
      setGraderModels(
        modelPage.list.filter((model) => model.enabled && model.modelType === "CHAT")
      );
      const details = await Promise.all(
        datasetPage.list.map((dataset) => getEvaluationDataset(dataset.id))
      );
      setVersions(
        details.flatMap((dataset) =>
          dataset.versions
            .filter((version) => version.status === "FROZEN")
            .map((version) => ({
              value: version.id,
              label: `${dataset.name} · v${version.version}（${version.caseCount} 条）`,
              caseCount: version.caseCount
            }))
        )
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建选项加载失败");
    }
  }

  async function submitRun(values: CreateRunForm) {
    setSubmitting(true);
    try {
      await createEvaluationRun({
        datasetVersionId: values.datasetVersionId,
        agentId: values.agentId,
        graderModelConfigId: values.graderModelConfigId,
        overrides: { retrieval: { topK: values.topK, scoreThreshold: values.scoreThreshold } }
      });
      message.success("评估运行已创建，正在后台执行");
      setDrawerOpen(false);
      form.resetFields();
      await loadRuns();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建评估运行失败");
    } finally {
      setSubmitting(false);
    }
  }

  const columns = useMemo<TableProps<EvaluationRun>["columns"]>(
    () => [
      {
        title: "状态",
        dataIndex: "status",
        width: 110,
        render: (value: EvaluationRunStatus) => (
          <Tag color={statusMeta[value].color}>{statusMeta[value].label}</Tag>
        )
      },
      {
        title: "数据集版本",
        render: (_, row) => (
          <span>
            {row.dataset.name} · v{row.dataset.version}
          </span>
        )
      },
      { title: "Agent", dataIndex: "agentName" },
      {
        title: "进度",
        width: 190,
        render: (_, row) => {
          const done = row.completedCases + row.failedCases + row.skippedCases;
          return (
            <Progress
              percent={row.totalCases ? Math.round((done / row.totalCases) * 100) : 0}
              size="small"
              format={() => `${done}/${row.totalCases}`}
            />
          );
        }
      },
      {
        title: "Recall@5",
        width: 100,
        render: (_, row) => formatPercent(row.summaryMetrics?.retrieval?.recallAt5)
      },
      {
        title: "成功率",
        width: 100,
        render: (_, row) => formatPercent(row.summaryMetrics?.runtime?.successRate)
      },
      {
        title: "P95 耗时",
        width: 110,
        render: (_, row) =>
          row.summaryMetrics?.runtime?.p95TotalMs == null
            ? "—"
            : `${Math.round(row.summaryMetrics.runtime.p95TotalMs)} ms`
      },
      {
        title: "创建时间",
        dataIndex: "createdAt",
        width: 180,
        render: (value: string) => new Date(value).toLocaleString()
      },
      {
        title: "操作",
        width: 160,
        render: (_, row) => (
          <Space>
            <Button type="link" onClick={() => navigate(`/operations/evaluations/runs/${row.id}`)}>
              查看报告
            </Button>
            {(row.status === "PENDING" || row.status === "RUNNING") && (
              <Button
                type="link"
                danger
                icon={<StopOutlined />}
                onClick={async () => {
                  await cancelEvaluationRun(row.id);
                  message.success("已请求取消");
                  await loadRuns();
                }}
              >
                取消
              </Button>
            )}
          </Space>
        )
      }
    ],
    [loadRuns, navigate]
  );

  return (
    <section className="workspace evaluationWorkspace">
      <WorkspacePageHeader
        title="RAG 评估运行"
        description="在冻结数据集上执行可复现的检索与回答评估。"
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void openCreateDrawer()}>
            创建评估
          </Button>
        }
      />
      <section className="panel evaluationFilters">
        <Select
          allowClear
          placeholder="全部状态"
          value={status}
          onChange={setStatus}
          style={{ width: 180 }}
          options={Object.entries(statusMeta).map(([value, meta]) => ({
            value,
            label: meta.label
          }))}
        />
      </section>
      <section className="panel evaluationTablePanel">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: "暂无评估运行" }}
        />
      </section>
      <Drawer
        title="创建评估运行"
        width={520}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={submitting} onClick={() => form.submit()}>
              创建并运行
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" onFinish={(values) => void submitRun(values)}>
          <Form.Item
            name="datasetVersionId"
            label="冻结数据集版本"
            rules={[{ required: true, message: "请选择冻结版本" }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={versions}
              placeholder="选择数据集版本"
            />
          </Form.Item>
          <Form.Item
            name="agentId"
            label="Agent"
            rules={[{ required: true, message: "请选择 Agent" }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={agents.map((agent) => ({
                value: agent.id,
                label: `${agent.name} · ${agent.modelName}`
              }))}
              placeholder="选择 Agent"
            />
          </Form.Item>
          <div className="evaluationFormGrid">
            <Form.Item name="topK" label="Top K" rules={[{ required: true }]}>
              <InputNumber min={1} max={50} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="scoreThreshold" label="分数阈值（可选）">
              <InputNumber min={0} max={1} step={0.05} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Form.Item
            name="graderModelConfigId"
            label="LLM 裁判模型（可选）"
            extra="启用后评估答案正确性、忠实度和相关性；Judge 用量与成本会单独统计。"
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="不启用答案质量评估"
              options={graderModels.map((model) => ({ value: model.id, label: model.modelName }))}
            />
          </Form.Item>
          <p className="evaluationImportHint">
            创建后会保存不含密钥的 Agent、模型、裁判与检索配置快照。未配置 Judge
            或价格的指标会显示为“未采集”，不会记作 0。
          </p>
        </Form>
      </Drawer>
    </section>
  );
}

function formatPercent(value: number | null | undefined): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}
