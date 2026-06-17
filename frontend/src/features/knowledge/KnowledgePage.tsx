import { useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Form, Modal } from "antd";

import { listModelConfigs } from "../model-providers/api";
import type { ModelConfigListItem } from "../model-providers/api";
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  getKnowledgeBase,
  listKnowledgeBases,
  updateKnowledgeBase
} from "./api";
import { KnowledgeBaseFormModal } from "./components/KnowledgeBaseFormModal";
import { KnowledgeBaseTable } from "./components/KnowledgeBaseTable";
import type { KnowledgeBaseFormValues, KnowledgeBaseTableItem } from "./types";
import "./knowledge.less";

export function KnowledgePage() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<KnowledgeBaseFormValues>();
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseTableItem[]>([]);
  const [modelConfigs, setModelConfigs] = useState<ModelConfigListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });

  const embeddingModelOptions = useMemo(
    () =>
      modelConfigs
        .filter((config) => config.modelType === "EMBEDDING" && config.enabled)
        .map((config) => ({
          label: config.modelName,
          value: config.id
        })),
    [modelConfigs]
  );

  useEffect(() => {
    void refresh(1, pagination.pageSize);
  }, []);

  async function refresh(nextPage = pagination.page, nextPageSize = pagination.pageSize) {
    setLoading(true);

    try {
      const [knowledgeBasePage, modelConfigPage] = await Promise.all([
        listKnowledgeBases(nextPage, nextPageSize),
        listModelConfigs(1, 100)
      ]);

      setKnowledgeBases(knowledgeBasePage.list);
      setModelConfigs(modelConfigPage.list);
      setPagination({
        page: knowledgeBasePage.page,
        pageSize: knowledgeBasePage.pageSize,
        total: knowledgeBasePage.total
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载知识库失败");
    } finally {
      setLoading(false);
    }
  }

  function openCreateDialog() {
    setEditingId(null);
    form.setFieldsValue({
      name: "",
      description: "",
      embeddingModelConfigId: embeddingModelOptions[0]?.value || "",
      enabled: true
    });
    setDialogOpen(true);
  }

  async function openEditDialog(id: string) {
    setLoading(true);

    try {
      const knowledgeBase = await getKnowledgeBase(id);
      setEditingId(knowledgeBase.id);
      form.setFieldsValue({
        name: knowledgeBase.name,
        description: knowledgeBase.description,
        embeddingModelConfigId: knowledgeBase.embeddingModelConfigId,
        enabled: knowledgeBase.enabled
      });
      setDialogOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载知识库详情失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(values: KnowledgeBaseFormValues) {
    setSaving(true);

    try {
      const payload = {
        name: values.name,
        description: values.description || "",
        embeddingModelConfigId: values.embeddingModelConfigId,
        enabled: values.enabled
      };

      if (editingId) {
        await updateKnowledgeBase(editingId, payload);
        message.success("知识库已更新");
      } else {
        await createKnowledgeBase(payload);
        message.success("知识库已创建");
      }

      closeDialog();
      await refresh(pagination.page, pagination.pageSize);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存知识库失败");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(id: string) {
    Modal.confirm({
      title: "删除知识库",
      content: "删除后该知识库将停用，后续不会被 Agent 检索。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => deleteById(id)
    });
  }

  async function deleteById(id: string) {
    setLoading(true);

    try {
      await deleteKnowledgeBase(id);
      message.success("知识库已删除");
      await refresh(pagination.page, pagination.pageSize);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除知识库失败");
    } finally {
      setLoading(false);
    }
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    form.resetFields();
  }

  return (
    <section className="workspace knowledgeWorkspace">
      <header className="compactPageHeader">
        <div>
          <h1>知识库</h1>
          <p>管理团队文档资料，为 Agent 提供 RAG 知识来源。</p>
        </div>
        <div className="knowledgeHeaderActions">
          <Button disabled={loading} onClick={() => void refresh()}>
            刷新
          </Button>
          <Button
            disabled={embeddingModelOptions.length === 0}
            type="primary"
            onClick={openCreateDialog}
          >
            新增知识库
          </Button>
        </div>
      </header>

      <section className="panel knowledgeTablePanel">
        <KnowledgeBaseTable
          knowledgeBases={knowledgeBases}
          loading={loading}
          pagination={pagination}
          onDelete={confirmDelete}
          onEdit={(id) => void openEditDialog(id)}
          onPageChange={(page, pageSize) => void refresh(page, pageSize)}
        />
      </section>

      <KnowledgeBaseFormModal
        editing={Boolean(editingId)}
        embeddingModelOptions={embeddingModelOptions}
        form={form}
        open={dialogOpen}
        saving={saving}
        onCancel={closeDialog}
        onSubmit={(values) => void handleSubmit(values)}
      />
    </section>
  );
}
