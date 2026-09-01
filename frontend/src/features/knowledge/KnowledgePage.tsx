import { useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Form, Modal } from "antd";

import { WorkspacePageHeader } from "../../shared/components/WorkspacePageHeader";
import { KnowledgeGuide } from "../../shared/components/menu-guides";

import { listModelConfigs } from "../model-providers/api";
import type { ModelConfigListItem } from "../model-providers/api";
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  getKnowledgeBase,
  listKnowledgeDocuments,
  listKnowledgeBases,
  reindexKnowledgeDocument,
  updateKnowledgeBase,
  uploadKnowledgeDocument
} from "./api";
import { KnowledgeBaseFormModal } from "./components/KnowledgeBaseFormModal";
import { KnowledgeBaseTable } from "./components/KnowledgeBaseTable";
import { KnowledgeDocumentDrawer } from "./components/KnowledgeDocumentDrawer";
import type {
  KnowledgeBaseFormValues,
  KnowledgeBaseTableItem,
  KnowledgeDocumentTableItem
} from "./types";
import "./knowledge.less";

export function KnowledgePage() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<KnowledgeBaseFormValues>();
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseTableItem[]>([]);
  const [modelConfigs, setModelConfigs] = useState<ModelConfigListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [documentDrawerOpen, setDocumentDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeKnowledgeBase, setActiveKnowledgeBase] = useState<KnowledgeBaseTableItem | null>(
    null
  );
  const [documents, setDocuments] = useState<KnowledgeDocumentTableItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [documentPagination, setDocumentPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0
  });

  const embeddingModelOptions = useMemo(
    () =>
      modelConfigs
        .filter((config) => config.modelType === "EMBEDDING" && config.enabled)
        .map((config) => ({
          label: `${config.modelName} · ${config.embeddingDimension ?? 1536} 维`,
          value: config.id
        })),
    [modelConfigs]
  );

  useEffect(() => {
    let disposed = false;
    void refresh(1, pagination.pageSize, () => !disposed);

    return () => {
      disposed = true;
    };
  }, []);

  async function refresh(
    nextPage = pagination.page,
    nextPageSize = pagination.pageSize,
    isActive: () => boolean = () => true
  ) {
    if (!isActive()) {
      return;
    }

    setLoading(true);

    try {
      const [knowledgeBasePage, modelConfigPage] = await Promise.all([
        listKnowledgeBases(nextPage, nextPageSize),
        listModelConfigs(1, 100)
      ]);

      if (isActive()) {
        setKnowledgeBases(knowledgeBasePage.list);
        setModelConfigs(modelConfigPage.list);
        setPagination({
          page: knowledgeBasePage.page,
          pageSize: knowledgeBasePage.pageSize,
          total: knowledgeBasePage.total
        });
      }
    } catch (error) {
      if (isActive()) {
        message.error(error instanceof Error ? error.message : "加载知识库失败");
      }
    } finally {
      if (isActive()) {
        setLoading(false);
      }
    }
  }

  function openCreateDialog() {
    if (embeddingModelOptions.length === 0) {
      message.warning("请先在模型供应商中配置并启用 Embedding 模型，再创建知识库。");
    }

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

  async function openDocumentDrawer(knowledgeBase: KnowledgeBaseTableItem) {
    setActiveKnowledgeBase(knowledgeBase);
    setDocumentDrawerOpen(true);
    await refreshDocuments(knowledgeBase.id, 1, documentPagination.pageSize);
  }

  async function refreshDocuments(
    knowledgeBaseId = activeKnowledgeBase?.id,
    nextPage = documentPagination.page,
    nextPageSize = documentPagination.pageSize
  ) {
    if (!knowledgeBaseId) {
      return;
    }

    setDocumentLoading(true);

    try {
      const documentPage = await listKnowledgeDocuments(knowledgeBaseId, nextPage, nextPageSize);
      setDocuments(documentPage.list);
      setDocumentPagination({
        page: documentPage.page,
        pageSize: documentPage.pageSize,
        total: documentPage.total
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载文档失败");
    } finally {
      setDocumentLoading(false);
    }
  }

  async function handleDocumentUpload(file: File) {
    if (!activeKnowledgeBase) {
      return;
    }

    setDocumentUploading(true);

    try {
      await uploadKnowledgeDocument(activeKnowledgeBase.id, file);
      message.success("文档已上传");
      await Promise.all([
        refreshDocuments(activeKnowledgeBase.id, 1, documentPagination.pageSize),
        refresh(pagination.page, pagination.pageSize)
      ]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "上传文档失败");
      throw error;
    } finally {
      setDocumentUploading(false);
    }
  }

  async function handleDocumentDelete(documentId: string) {
    if (!activeKnowledgeBase) {
      return;
    }

    setDocumentLoading(true);

    try {
      await deleteKnowledgeDocument(activeKnowledgeBase.id, documentId);
      message.success("文档已删除");
      await Promise.all([
        refreshDocuments(
          activeKnowledgeBase.id,
          documentPagination.page,
          documentPagination.pageSize
        ),
        refresh(pagination.page, pagination.pageSize)
      ]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除文档失败");
    } finally {
      setDocumentLoading(false);
    }
  }

  async function handleDocumentReindex(documentId: string) {
    if (!activeKnowledgeBase) {
      return;
    }

    setDocumentLoading(true);

    try {
      const document = await reindexKnowledgeDocument(activeKnowledgeBase.id, documentId);

      if (document.status !== "indexed") {
        throw new Error(document.errorMessage ?? "重新索引失败");
      }

      message.success("文档已重新索引");
      await Promise.all([
        refreshDocuments(
          activeKnowledgeBase.id,
          documentPagination.page,
          documentPagination.pageSize
        ),
        refresh(pagination.page, pagination.pageSize)
      ]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "重新索引失败");
    } finally {
      setDocumentLoading(false);
    }
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    form.resetFields();
  }

  function closeDocumentDrawer() {
    setDocumentDrawerOpen(false);
    setActiveKnowledgeBase(null);
    setDocuments([]);
    setDocumentPagination({
      page: 1,
      pageSize: 20,
      total: 0
    });
  }

  return (
    <section className="workspace knowledgeWorkspace">
      <WorkspacePageHeader
        actions={
          <>
            <KnowledgeGuide />
            <Button disabled={loading} onClick={() => void refresh()}>
              刷新
            </Button>
            <Button type="primary" onClick={openCreateDialog}>
              新增知识库
            </Button>
          </>
        }
        description="管理团队文档资料，为 Agent 提供 RAG 知识来源。"
        title="知识库"
      />

      <section className="panel knowledgeTablePanel">
        <KnowledgeBaseTable
          knowledgeBases={knowledgeBases}
          loading={loading}
          pagination={pagination}
          onDelete={confirmDelete}
          onEdit={(id) => void openEditDialog(id)}
          onOpenDocuments={(knowledgeBase) => void openDocumentDrawer(knowledgeBase)}
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

      <KnowledgeDocumentDrawer
        documents={documents}
        knowledgeBase={activeKnowledgeBase}
        loading={documentLoading}
        open={documentDrawerOpen}
        pagination={documentPagination}
        uploading={documentUploading}
        onClose={closeDocumentDrawer}
        onDelete={(documentId) => void handleDocumentDelete(documentId)}
        onPageChange={(page, pageSize) => void refreshDocuments(undefined, page, pageSize)}
        onReindex={(documentId) => void handleDocumentReindex(documentId)}
        onRefresh={() => void refreshDocuments()}
        onUpload={handleDocumentUpload}
      />
    </section>
  );
}
