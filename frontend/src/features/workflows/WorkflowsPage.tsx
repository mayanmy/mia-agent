import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckOutlined,
  CloudUploadOutlined,
  HistoryOutlined,
  PlusOutlined,
  RedoOutlined,
  UndoOutlined,
  SaveOutlined
} from "@ant-design/icons";
import { App as AntdApp, Button, Spin, Tag } from "antd";
import { useNavigate, useParams } from "react-router-dom";

import { listKnowledgeBases } from "../knowledge/api";
import { listModelConfigs } from "../model-providers/api";
import { listTools } from "../tools/api";
import { WorkspacePageHeader } from "../../shared/components/WorkspacePageHeader";
import {
  archiveWorkflow,
  createWorkflow,
  getWorkflow,
  listWorkflows,
  publishWorkflow,
  updateWorkflowDraft,
  validateWorkflow
} from "./api";
import { NodeInspector } from "./components/NodeInspector";
import { NodePalette } from "./components/NodePalette";
import { CreateWorkflowModal, type WorkflowCreateValues } from "./components/CreateWorkflowModal";
import { ValidationPanel } from "./components/ValidationPanel";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import { WorkflowGuide } from "./components/WorkflowGuide";
import { WorkflowGallery } from "./components/WorkflowGallery";
import { WorkflowTraceDrawer } from "./components/WorkflowTraceDrawer";
import { appendNodeToGraph, insertNodeOnEdge } from "./editor/graph-commands";
import { useWorkflowEditor } from "./editor/useWorkflowEditor";
import type {
  WorkflowDetail,
  WorkflowGraph,
  WorkflowListItem,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowResources,
  WorkflowTraceNodeStatus,
  WorkflowValidationIssue
} from "./types";
import { createDefaultGraph, createWorkflowNode } from "./utils";
import "./workflows.less";

const emptyResources: WorkflowResources = { models: [], knowledgeBases: [], tools: [] };
const WORKFLOW_PALETTE_COLLAPSED_KEY = "mia.workflow.palette.collapsed";
const WORKFLOW_INSPECTOR_COLLAPSED_KEY = "mia.workflow.inspector.collapsed";

/** 草稿自动保存状态。 */
type DraftSaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "failed";

/** Workflow 路由页，负责编排资源、草稿、画布校验、发布和 Trace 状态。 */
export function WorkflowsPage() {
  const { message, modal } = AntdApp.useApp();
  const navigate = useNavigate();
  const { workflowId } = useParams<{ workflowId?: string }>();
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const { graph, commitGraph, resetGraph, undo, redo, canUndo, canRedo } =
    useWorkflowEditor(createDefaultGraph());
  const [resources, setResources] = useState<WorkflowResources>(emptyResources);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [issues, setIssues] = useState<WorkflowValidationIssue[]>([]);
  const [validationValid, setValidationValid] = useState<boolean | null>(null);
  const [traceStatuses, setTraceStatuses] = useState<Record<string, WorkflowTraceNodeStatus>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(() =>
    readCollapsedState(WORKFLOW_PALETTE_COLLAPSED_KEY)
  );
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() =>
    readCollapsedState(WORKFLOW_INSPECTOR_COLLAPSED_KEY)
  );
  const workflowRef = useRef<WorkflowDetail | null>(null);
  const graphRef = useRef(graph);
  const saveInFlightRef = useRef<Promise<number> | null>(null);

  workflowRef.current = workflow;
  graphRef.current = graph;

  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId]
  );

  useEffect(() => {
    void loadInitialData();
  }, [workflowId]);

  /** 非表单区域支持标准 Undo/Redo 快捷键，避免覆盖文本框自身的撤销栈。 */
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      setDirty(true);
      setSaveStatus("dirty");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [redo, undo]);

  /** 并行加载 Workflow 与跨模块资源，并默认打开第一条记录。 */
  async function loadInitialData() {
    setLoading(true);
    try {
      if (!workflowId) {
        const workflowPage = await listWorkflows();
        setWorkflows(workflowPage.list);
        setWorkflow(null);
        return;
      }
      const [workflowPage, modelPage, knowledgePage, tools] = await Promise.all([
        listWorkflows(),
        listModelConfigs(),
        listKnowledgeBases(1, 100),
        listTools()
      ]);
      setWorkflows(workflowPage.list);
      setResources({
        models: modelPage.list
          .filter((item) => item.enabled && item.modelType === "CHAT")
          .map((item) => ({ id: item.id, label: item.modelName })),
        knowledgeBases: knowledgePage.list
          .filter((item) => item.enabled)
          .map((item) => ({ id: item.id, label: item.name })),
        tools: tools
          .filter((item) => item.enabled)
          .map((item) => ({ id: item.id, label: item.name }))
      });
      await openWorkflow(workflowId, false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载 Workflow 失败");
    } finally {
      setLoading(false);
    }
  }

  async function refreshList(selectedId?: string) {
    const page = await listWorkflows();
    setWorkflows(page.list);
    if (selectedId) {
      const detail = await getWorkflow(selectedId);
      setWorkflow(detail);
    }
  }

  /** 用服务端 Graph 替换编辑状态，并清空旧 Workflow 的校验和 Trace 状态。 */
  async function openWorkflow(id: string, manageLoading = true) {
    if (manageLoading) setLoading(true);
    try {
      const detail = await getWorkflow(id);
      setWorkflow(detail);
      resetGraph(detail.draftGraph);
      setSelectedNodeId(null);
      setIssues([]);
      setValidationValid(null);
      setTraceStatuses({});
      setDirty(false);
      setSaveStatus("saved");
      setLastSavedAt(detail.updatedAt);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载 Workflow 失败");
    } finally {
      if (manageLoading) setLoading(false);
    }
  }

  /** 所有画布修改统一经过该入口，以同步 dirty 和失效派生状态。 */
  function changeGraph(next: WorkflowGraph, mergeKey?: string) {
    commitGraph(next, mergeKey);
    setDirty(true);
    setSaveStatus("dirty");
    setValidationValid(null);
    setTraceStatuses({});
  }

  /** 创建带最小默认配置的节点，并为资源节点选择首个可用资源。 */
  function createConfiguredNode(type: WorkflowNodeType, position?: { x: number; y: number }) {
    const node = createWorkflowNode(type, graph.nodes.length);
    if (position) node.position = position;
    if (type === "llm" && resources.models[0]) node.config.modelConfigId = resources.models[0].id;
    if (type === "retrieval" && resources.knowledgeBases[0]) {
      node.config.knowledgeBaseIds = [resources.knowledgeBases[0].id];
    }
    if (type === "tool" && resources.tools[0]) node.config.toolId = resources.tools[0].id;
    return node;
  }

  /** 确保 Start/End 的单例约束，并创建带资源默认值的节点。 */
  function addNode(type: WorkflowNodeType) {
    if ((type === "start" || type === "end") && graph.nodes.some((node) => node.type === type)) {
      message.warning(type === "start" ? "只能有一个开始节点" : "当前已有结束节点");
      return;
    }
    const node = createConfiguredNode(type);
    changeGraph({ ...graph, nodes: [...graph.nodes, node] });
    setSelectedNodeId(node.id);
  }

  /** 从指定出口追加节点；已有连线时要求用户改用连线中点插入。 */
  function appendNode(
    sourceNodeId: string,
    sourceHandle: string | undefined,
    type: WorkflowNodeType
  ) {
    if (type === "end" && graph.nodes.some((node) => node.type === "end")) {
      message.warning("当前已有结束节点");
      return;
    }
    const connectedEdge = graph.edges.find(
      (edge) =>
        edge.source === sourceNodeId &&
        (edge.sourceHandle ?? undefined) === (sourceHandle || undefined)
    );
    // 出口已有连线时复用同一个快捷入口执行“连线插入”，避免用户选完类型后才被阻断。
    if (connectedEdge) {
      const node = createConfiguredNode(type);
      changeGraph(insertNodeOnEdge(graph, connectedEdge.id, node));
      setSelectedNodeId(node.id);
      return;
    }
    const source = graph.nodes.find((node) => node.id === sourceNodeId);
    const node = createConfiguredNode(type, {
      x: (source?.position?.x ?? 0) + 280,
      y: source?.position?.y ?? 0
    });
    changeGraph(appendNodeToGraph(graph, sourceNodeId, sourceHandle, node));
    setSelectedNodeId(node.id);
  }

  /** 将新节点事务性插入连线，原 Condition sourceHandle 由 Graph Command 保留。 */
  function insertNode(edgeId: string, type: WorkflowNodeType) {
    if (type === "end" && graph.nodes.some((node) => node.type === "end")) {
      message.warning("当前已有结束节点");
      return;
    }
    const node = createConfiguredNode(type);
    changeGraph(insertNodeOnEdge(graph, edgeId, node));
    setSelectedNodeId(node.id);
  }

  function updateNode(next: WorkflowNode) {
    changeGraph(
      {
        ...graph,
        nodes: graph.nodes.map((node) => (node.id === next.id ? next : node))
      },
      `node:${next.id}:config`
    );
  }

  /** 删除节点时同步清理全部关联边，避免保存悬空连接。 */
  function deleteNode(nodeId: string) {
    changeGraph({
      ...graph,
      nodes: graph.nodes.filter((node) => node.id !== nodeId),
      edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
    });
    setSelectedNodeId(null);
  }

  /** 使用当前 draftRevision 保存完整 Graph，并更新页面和侧栏的修订号。 */
  const saveDraft = useCallback(
    async (showSuccess = true): Promise<number> => {
      if (saveInFlightRef.current) return saveInFlightRef.current;
      const initialWorkflow = workflowRef.current;
      if (!initialWorkflow) throw new Error("请先选择 Workflow");

      const task = (async () => {
        let revision = initialWorkflow.draftRevision;
        setSaving(true);
        try {
          // 保存期间产生的新编辑会进入下一轮，保证请求严格串行且最终落盘的是最新快照。
          while (true) {
            const snapshot = graphRef.current;
            setSaveStatus("saving");
            const result = await updateWorkflowDraft(initialWorkflow.id, revision, snapshot);
            revision = result.draftRevision;
            setLastSavedAt(result.updatedAt);
            setWorkflow((current) =>
              current?.id === initialWorkflow.id
                ? {
                    ...current,
                    draftRevision: revision,
                    draftGraph: snapshot,
                    updatedAt: result.updatedAt
                  }
                : current
            );
            setWorkflows((items) =>
              items.map((item) =>
                item.id === initialWorkflow.id
                  ? { ...item, draftRevision: revision, updatedAt: result.updatedAt }
                  : item
              )
            );
            if (graphRef.current === snapshot) break;
          }
          setDirty(false);
          setSaveStatus("saved");
          if (showSuccess) message.success("草稿已保存");
          return revision;
        } catch (error) {
          const conflict = error instanceof Error && /冲突|revision|更新/.test(error.message);
          setSaveStatus(conflict ? "conflict" : "failed");
          setDirty(true);
          if (!showSuccess) message.error(error instanceof Error ? error.message : "自动保存失败");
          throw error;
        } finally {
          setSaving(false);
        }
      })();
      saveInFlightRef.current = task;
      try {
        return await task;
      } finally {
        saveInFlightRef.current = null;
      }
    },
    [message]
  );

  /** 停止编辑后自动保存，窗口失焦时立即触发尚未落盘的修改。 */
  useEffect(() => {
    if (!dirty || !workflow) return;
    const timer = window.setTimeout(() => void saveDraft(false), 1200);
    const flushOnBlur = () => void saveDraft(false);
    window.addEventListener("blur", flushOnBlur);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("blur", flushOnBlur);
    };
  }, [dirty, graph, workflow?.id, saveDraft]);

  async function saveDraftWithFeedback() {
    try {
      await saveDraft();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存草稿失败");
    }
  }

  /** 调用后端 Compiler 并将首个节点级问题定位到画布。 */
  async function runValidation() {
    if (!workflow) return null;
    setSaving(true);
    try {
      const result = await validateWorkflow(workflow.id, graph);
      setIssues(result.issues);
      setValidationValid(result.valid);
      if (result.valid) message.success("Workflow 校验通过");
      else {
        message.error("Workflow 存在配置问题");
        const firstNode = result.issues.find((issue) => issue.nodeId)?.nodeId;
        if (firstNode) setSelectedNodeId(firstNode);
      }
      return result;
    } catch (error) {
      message.error(error instanceof Error ? error.message : "校验失败");
      return null;
    } finally {
      setSaving(false);
    }
  }

  /** 发布前保存未提交修改并再次校验，确保版本来自确定草稿。 */
  async function publish() {
    if (!workflow) return;
    try {
      const revision = dirty ? await saveDraft(false) : workflow.draftRevision;
      const validation = await validateWorkflow(workflow.id, graph);
      setIssues(validation.issues);
      setValidationValid(validation.valid);
      if (!validation.valid) {
        const firstNode = validation.issues.find((issue) => issue.nodeId)?.nodeId;
        if (firstNode) setSelectedNodeId(firstNode);
        message.error("修复校验问题后才能发布");
        return;
      }
      setSaving(true);
      if (!validation.checksum) {
        message.error("校验结果缺少内容摘要，无法安全发布");
        return;
      }
      const result = await publishWorkflow(workflow.id, revision, validation.checksum);
      await refreshList(workflow.id);
      message.success(`已发布 Workflow v${result.version}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "发布失败");
    } finally {
      setSaving(false);
    }
  }

  async function submitCreate(values: WorkflowCreateValues) {
    setSaving(true);
    try {
      const created = await createWorkflow({ ...values, graph: createDefaultGraph() });
      setCreateOpen(false);
      navigate(`/workflows/${created.id}`);
      message.success("Workflow 已创建");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  function confirmArchive(item: WorkflowListItem) {
    modal.confirm({
      title: "归档 Workflow",
      content: `归档“${item.name}”后将从编辑列表移除，历史版本和 Run Trace 仍会保留。`,
      okText: "归档",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        await archiveWorkflow(item.id);
        const page = await listWorkflows();
        setWorkflows(page.list);
        if (workflow?.id === item.id) {
          setWorkflow(null);
          setSelectedNodeId(null);
          navigate("/workflows");
        }
      }
    });
  }

  return (
    <section className="workspace workflowWorkspace">
      <WorkspacePageHeader
        actions={
          !workflowId ? (
            <>
              <WorkflowGuide />
              <Button icon={<PlusOutlined />} type="primary" onClick={() => setCreateOpen(true)}>
                新建 Workflow
              </Button>
            </>
          ) : workflow ? (
            <>
              {saveStatus === "conflict" ? (
                <>
                  <Button onClick={() => void openWorkflow(workflow.id)}>重新加载草稿</Button>
                  <Button
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(JSON.stringify(graph, null, 2))
                        .then(() => message.success("本地 Graph 已复制"))
                        .catch(() => message.error("复制失败，请使用浏览器剪贴板权限后重试"));
                    }}
                  >
                    复制本地 Graph
                  </Button>
                </>
              ) : null}
              <Button
                disabled={!canUndo}
                icon={<UndoOutlined />}
                title="撤销（Cmd/Ctrl+Z）"
                type="text"
                onClick={() => {
                  undo();
                  setDirty(true);
                  setSaveStatus("dirty");
                }}
              />
              <Button
                disabled={!canRedo}
                icon={<RedoOutlined />}
                title="重做（Cmd/Ctrl+Shift+Z）"
                type="text"
                onClick={() => {
                  redo();
                  setDirty(true);
                  setSaveStatus("dirty");
                }}
              />
              <Button icon={<HistoryOutlined />} onClick={() => setTraceOpen(true)}>
                Trace
              </Button>
              <Button
                icon={<CheckOutlined />}
                loading={saving}
                onClick={() => void runValidation()}
              >
                校验
              </Button>
              {saveStatus === "failed" ? (
                <Button
                  icon={<SaveOutlined />}
                  loading={saving}
                  onClick={() => void saveDraftWithFeedback()}
                >
                  重试保存
                </Button>
              ) : null}
              <Button
                icon={<CloudUploadOutlined />}
                loading={saving}
                type="primary"
                onClick={() => void publish()}
              >
                发布
              </Button>
            </>
          ) : undefined
        }
        backLabel="返回 Workflow 工作室"
        description={
          workflowId
            ? workflow?.description || "构建确定性 Agent 流程，校验后发布为不可变版本。"
            : "创建和管理团队的确定性 Agent 流程。"
        }
        eyebrow={workflowId ? "Workflow 编排" : undefined}
        meta={
          workflow ? (
            <>
              <Tag color={workflow.status === "PUBLISHED" ? "green" : "default"}>
                {workflow.publishedVersion ? `已发布 v${workflow.publishedVersion}` : "未发布"}
              </Tag>
              <span>{formatSaveStatus(saveStatus, workflow.draftRevision, lastSavedAt)}</span>
            </>
          ) : undefined
        }
        title={workflowId ? workflow?.name || "正在加载 Workflow…" : "Workflow 工作室"}
        onBack={workflowId ? () => navigate("/workflows") : undefined}
      />

      {!workflowId ? (
        <WorkflowGallery
          loading={loading}
          workflows={workflows}
          onArchive={confirmArchive}
          onCreate={() => setCreateOpen(true)}
          onOpen={(id) => navigate(`/workflows/${id}`)}
        />
      ) : null}

      {workflowId ? (
        <div className="workflowWorkbench detailOnly">
          {workflow ? (
            <main className="workflowEditor">
              <div
                className={`workflowEditorBody${paletteCollapsed ? " paletteCollapsed" : ""}${inspectorCollapsed ? " inspectorCollapsed" : ""}`}
              >
                <NodePalette
                  collapsed={paletteCollapsed}
                  onAdd={addNode}
                  onToggleCollapsed={() =>
                    toggleCollapsedState(
                      WORKFLOW_PALETTE_COLLAPSED_KEY,
                      paletteCollapsed,
                      setPaletteCollapsed
                    )
                  }
                />
                <div className="workflowCanvasRegion">
                  <WorkflowCanvas
                    graph={graph}
                    issues={issues}
                    selectedNodeId={selectedNodeId}
                    traceStatuses={traceStatuses}
                    onConnectionRejected={(reason) => message.warning(reason)}
                    onGraphChange={changeGraph}
                    onAppendNode={appendNode}
                    onInsertNode={insertNode}
                    onOpenNodeInspector={(nodeId) => {
                      setSelectedNodeId(nodeId);
                      window.localStorage.setItem(WORKFLOW_INSPECTOR_COLLAPSED_KEY, "false");
                      setInspectorCollapsed(false);
                    }}
                    onSelectNode={setSelectedNodeId}
                  />
                  <ValidationPanel
                    issues={issues}
                    valid={validationValid}
                    onSelectNode={setSelectedNodeId}
                  />
                </div>
                <NodeInspector
                  collapsed={inspectorCollapsed}
                  graph={graph}
                  node={selectedNode}
                  resources={resources}
                  onChange={updateNode}
                  onDelete={deleteNode}
                  onToggleCollapsed={() =>
                    toggleCollapsedState(
                      WORKFLOW_INSPECTOR_COLLAPSED_KEY,
                      inspectorCollapsed,
                      setInspectorCollapsed
                    )
                  }
                />
              </div>
            </main>
          ) : (
            <main className="workflowEmptyEditor">
              <Spin spinning={loading} />
              {!loading ? <p>选择或新建 Workflow 开始编排</p> : null}
            </main>
          )}
        </div>
      ) : null}

      <CreateWorkflowModal
        open={createOpen}
        saving={saving}
        onCancel={() => setCreateOpen(false)}
        onSubmit={submitCreate}
      />

      <WorkflowTraceDrawer
        open={traceOpen}
        workflowId={workflow?.id ?? null}
        onClose={() => setTraceOpen(false)}
        onReplay={setTraceStatuses}
      />
    </section>
  );
}

/** 将保存状态机转换为顶部可扫描文案。 */
function formatSaveStatus(status: DraftSaveStatus, revision: number, savedAt: string | null) {
  if (status === "dirty") return "有未保存修改";
  if (status === "saving") return "保存中…";
  if (status === "failed") return "保存失败，点击保存重试";
  if (status === "conflict") return "草稿发生冲突，请重新加载";
  if (status === "saved" && savedAt) {
    return `已保存 ${new Date(savedAt).toLocaleTimeString("zh-CN", { hour12: false })} · r${revision}`;
  }
  return `草稿 r${revision}`;
}

/** 从本地存储恢复单个面板的折叠状态。 */
function readCollapsedState(key: string): boolean {
  return window.localStorage.getItem(key) === "true";
}

/** 切换并持久化面板折叠状态，刷新页面后继续沿用管理员布局。 */
function toggleCollapsedState(key: string, current: boolean, update: (collapsed: boolean) => void) {
  const next = !current;
  window.localStorage.setItem(key, String(next));
  update(next);
}
