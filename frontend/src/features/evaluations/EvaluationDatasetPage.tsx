import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CopyOutlined, ImportOutlined, LockOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag
} from "antd";
import type { TableProps } from "antd";

import { WorkspacePageHeader } from "../../shared/components/WorkspacePageHeader";
import {
  createEvaluationCase,
  createEvaluationVersion,
  deleteEvaluationCase,
  freezeEvaluationVersion,
  getEvaluationDataset,
  listEvaluationCases,
  updateEvaluationCase,
  type EvaluationCase,
  type EvaluationCaseInput,
  type EvaluationDatasetDetail,
  type EvaluationVersion
} from "./api";
import "./evaluations.less";
import { DatasetImportModal } from "./components/DatasetImportModal";

export function EvaluationDatasetPage() {
  const { message, modal } = AntdApp.useApp();
  const navigate = useNavigate();
  const { datasetId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm<EvaluationCaseInput>();
  const [dataset, setDataset] = useState<EvaluationDatasetDetail | null>(null);
  const [cases, setCases] = useState<EvaluationCase[]>([]);
  const [paging, setPaging] = useState({ page: 1, pageSize: 20, total: 0 });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [caseModalOpen, setCaseModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<EvaluationCase | null>(null);
  const selectedVersionId = searchParams.get("versionId");
  const selectedVersion = useMemo(
    () => dataset?.versions.find((item) => item.id === selectedVersionId) ?? dataset?.versions[0],
    [dataset, selectedVersionId]
  );
  const mutable = selectedVersion?.status === "DRAFT";

  useEffect(() => {
    void loadDataset();
  }, [datasetId]);

  useEffect(() => {
    if (selectedVersion) void loadCases(selectedVersion.id, 1);
  }, [selectedVersion?.id]);

  async function loadDataset(preferredVersionId?: string) {
    setLoading(true);
    try {
      const detail = await getEvaluationDataset(datasetId);
      setDataset(detail);
      const versionId = preferredVersionId ?? selectedVersionId ?? detail.versions[0]?.id;
      if (versionId) setSearchParams({ versionId }, { replace: true });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载数据集失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadCases(versionId: string, page = paging.page, pageSize = paging.pageSize) {
    setLoading(true);
    try {
      const result = await listEvaluationCases(versionId, { page, pageSize });
      setCases(result.list);
      setPaging({ page: result.page, pageSize: result.pageSize, total: result.total });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载评估用例失败");
    } finally {
      setLoading(false);
    }
  }

  function openCaseModal(item?: EvaluationCase) {
    setEditingCase(item ?? null);
    form.setFieldsValue(
      item
        ? {
            question: item.question,
            expectedAnswer: item.expectedAnswer,
            answerable: item.answerable,
            category: item.category,
            difficulty: item.difficulty,
            expectedDocumentIds: item.expectedDocumentIds,
            expectedChunkIds: item.expectedChunkIds
          }
        : { answerable: true }
    );
    setCaseModalOpen(true);
  }

  async function saveCase() {
    if (!selectedVersion) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editingCase) await updateEvaluationCase(selectedVersion.id, editingCase.id, values);
      else await createEvaluationCase(selectedVersion.id, values);
      message.success(editingCase ? "用例已更新" : "用例已创建");
      setCaseModalOpen(false);
      form.resetFields();
      await loadDataset(selectedVersion.id);
      await loadCases(selectedVersion.id, 1);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存用例失败");
    } finally {
      setSaving(false);
    }
  }

  async function copyFrozenVersion() {
    if (!dataset) return;
    const source = dataset.versions.find((item) => item.status === "FROZEN");
    if (!source) {
      message.warning("没有可复制的冻结版本");
      return;
    }
    try {
      const version = await createEvaluationVersion(dataset.id, source.id);
      message.success(`已创建 v${version.version} 草稿`);
      await loadDataset(version.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建版本失败");
    }
  }

  function confirmFreeze(version: EvaluationVersion) {
    modal.confirm({
      title: `冻结 v${version.version}？`,
      content: `冻结后 ${version.caseCount} 条用例将不可修改，后续变更需要复制为新草稿。`,
      okText: "确认冻结",
      onOk: async () => {
        const frozen = await freezeEvaluationVersion(version.id, version.revision);
        message.success("版本已冻结");
        await loadDataset(frozen.id);
      }
    });
  }

  const columns: TableProps<EvaluationCase>["columns"] = [
    { title: "问题", dataIndex: "question", ellipsis: true },
    { title: "分类", dataIndex: "category", width: 130, render: (value) => value || "—" },
    { title: "难度", dataIndex: "difficulty", width: 100, render: (value) => value || "—" },
    {
      title: "可回答",
      dataIndex: "answerable",
      width: 90,
      render: (value: boolean) => (
        <Tag color={value ? "green" : "default"}>{value ? "是" : "否"}</Tag>
      )
    },
    { title: "期望文档", width: 100, render: (_, item) => item.expectedDocumentIds.length },
    { title: "来源", dataIndex: "sourceType", width: 130 },
    {
      title: "操作",
      width: 130,
      render: (_, item) => (
        <Space>
          <Button type="link" size="small" disabled={!mutable} onClick={() => openCaseModal(item)}>
            编辑
          </Button>
          <Button
            danger
            type="link"
            size="small"
            disabled={!mutable}
            onClick={() =>
              modal.confirm({
                title: "删除该评估用例？",
                okButtonProps: { danger: true },
                onOk: async () => {
                  await deleteEvaluationCase(selectedVersion!.id, item.id);
                  await loadDataset(selectedVersion!.id);
                  await loadCases(selectedVersion!.id, 1);
                }
              })
            }
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  return (
    <section className="workspace evaluationWorkspace">
      <WorkspacePageHeader
        title={dataset?.name ?? "评估数据集"}
        description={dataset?.description || "管理版本化评估问题和标准答案。"}
        eyebrow="评估数据集"
        onBack={() => navigate("/operations/evaluation-datasets")}
        meta={
          selectedVersion ? (
            <Tag color={mutable ? "gold" : "blue"}>
              v{selectedVersion.version} · {mutable ? "草稿" : "已冻结"}
            </Tag>
          ) : null
        }
        actions={
          <Space wrap>
            <Select
              aria-label="数据集版本"
              value={selectedVersion?.id}
              style={{ width: 150 }}
              options={dataset?.versions.map((item) => ({
                label: `v${item.version} · ${item.status === "DRAFT" ? "草稿" : "已冻结"}`,
                value: item.id
              }))}
              onChange={(versionId) => setSearchParams({ versionId })}
            />
            {mutable && selectedVersion ? (
              <Button
                icon={<LockOutlined />}
                disabled={selectedVersion.caseCount === 0}
                onClick={() => confirmFreeze(selectedVersion)}
              >
                冻结版本
              </Button>
            ) : (
              <Button icon={<CopyOutlined />} onClick={() => void copyFrozenVersion()}>
                复制为新草稿
              </Button>
            )}
            <Button
              icon={<ImportOutlined />}
              disabled={!mutable}
              onClick={() => setImportModalOpen(true)}
            >
              导入
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!mutable}
              onClick={() => openCaseModal()}
            >
              新增用例
            </Button>
          </Space>
        }
      />
      {!mutable && selectedVersion ? (
        <div className="evaluationFrozenNotice">
          该版本已冻结，只能查看。需要修改时请复制为新草稿。
        </div>
      ) : null}
      <section className="panel evaluationTablePanel">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={cases}
          loading={loading}
          pagination={{
            current: paging.page,
            pageSize: paging.pageSize,
            total: paging.total,
            showSizeChanger: true,
            onChange: (page, pageSize) =>
              selectedVersion && void loadCases(selectedVersion.id, page, pageSize)
          }}
        />
      </section>
      <Modal
        width={720}
        title={editingCase ? "编辑评估用例" : "新增评估用例"}
        open={caseModalOpen}
        confirmLoading={saving}
        okText="保存"
        onCancel={() => {
          setCaseModalOpen(false);
          form.resetFields();
        }}
        onOk={() => void saveCase()}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="question"
            label="问题"
            rules={[{ required: true, message: "请输入问题" }]}
          >
            <Input.TextArea rows={3} maxLength={20000} showCount />
          </Form.Item>
          <Form.Item name="expectedAnswer" label="标准答案">
            <Input.TextArea rows={5} maxLength={50000} showCount />
          </Form.Item>
          <div className="evaluationFormGrid">
            <Form.Item name="category" label="分类">
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item name="difficulty" label="难度">
              <Select
                allowClear
                options={[
                  { label: "简单", value: "easy" },
                  { label: "中等", value: "medium" },
                  { label: "困难", value: "hard" }
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item name="answerable" label="知识库应能回答" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
      {selectedVersion ? (
        <DatasetImportModal
          open={importModalOpen}
          versionId={selectedVersion.id}
          onClose={() => setImportModalOpen(false)}
          onImported={async () => {
            await loadDataset(selectedVersion.id);
            await loadCases(selectedVersion.id, 1);
          }}
        />
      ) : null}
    </section>
  );
}
