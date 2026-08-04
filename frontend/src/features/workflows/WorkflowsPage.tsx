import { useEffect, useMemo, useState } from "react";
import {
  CheckOutlined,
  CloudUploadOutlined,
  HistoryOutlined,
  PlusOutlined,
  SaveOutlined
} from "@ant-design/icons";
import { App as AntdApp, Button, Space, Spin, Tag } from "antd";

import { listKnowledgeBases } from "../knowledge/api";
import { listModelConfigs } from "../model-providers/api";
import { listTools } from "../tools/api";
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
import { WorkflowSidebar } from "./components/WorkflowSidebar";
import { WorkflowTraceDrawer } from "./components/WorkflowTraceDrawer";
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

/** Workflow 路由页，负责编排资源、草稿、画布校验、发布和 Trace 状态。 */
export function WorkflowsPage() {
  const { message, modal } = AntdApp.useApp();
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [graph, setGraph] = useState<WorkflowGraph>(createDefaultGraph());
  const [resources, setResources] = useState<WorkflowResources>(emptyResources);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [issues, setIssues] = useState<WorkflowValidationIssue[]>([]);
  const [validationValid, setValidationValid] = useState<boolean | null>(null);
  const [traceStatuses, setTraceStatuses] = useState<Record<string, WorkflowTraceNodeStatus>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);

  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId]
  );

  useEffect(() => {
    void loadInitialData();
  }, []);

  /** 并行加载 Workflow 与跨模块资源，并默认打开第一条记录。 */
  async function loadInitialData() {
    setLoading(true);
    try {
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
      if (workflowPage.list[0]) await openWorkflow(workflowPage.list[0].id, false);
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

  /** 切换 Workflow 前保护尚未保存的画布修改。 */
  function requestOpenWorkflow(id: string) {
    if (!dirty) {
      void openWorkflow(id);
      return;
    }
    modal.confirm({
      title: "放弃未保存修改？",
      content: "切换 Workflow 会丢失当前画布尚未保存的修改。",
      okText: "放弃并切换",
      cancelText: "继续编辑",
      onOk: () => openWorkflow(id)
    });
  }

  /** 用服务端 Graph 替换编辑状态，并清空旧 Workflow 的校验和 Trace 状态。 */
  async function openWorkflow(id: string, manageLoading = true) {
    if (manageLoading) setLoading(true);
    try {
      const detail = await getWorkflow(id);
      setWorkflow(detail);
      setGraph(detail.draftGraph);
      setSelectedNodeId(null);
      setIssues([]);
      setValidationValid(null);
      setTraceStatuses({});
      setDirty(false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载 Workflow 失败");
    } finally {
      if (manageLoading) setLoading(false);
    }
  }

  /** 所有画布修改统一经过该入口，以同步 dirty 和失效派生状态。 */
  function changeGraph(next: WorkflowGraph) {
    setGraph(next);
    setDirty(true);
    setValidationValid(null);
    setTraceStatuses({});
  }

  /** 创建带最小默认配置的节点，并为资源节点选择首个可用资源。 */
  function addNode(type: WorkflowNodeType) {
    if ((type === "start" || type === "end") && graph.nodes.some((node) => node.type === type)) {
      message.warning(type === "start" ? "只能有一个开始节点" : "当前已有结束节点");
      return;
    }
    const node = createWorkflowNode(type, graph.nodes.length);
    if (type === "llm" && resources.models[0]) node.config.modelConfigId = resources.models[0].id;
    if (type === "retrieval" && resources.knowledgeBases[0]) {
      node.config.knowledgeBaseIds = [resources.knowledgeBases[0].id];
    }
    if (type === "tool" && resources.tools[0]) node.config.toolId = resources.tools[0].id;
    changeGraph({ ...graph, nodes: [...graph.nodes, node] });
    setSelectedNodeId(node.id);
  }

  function updateNode(next: WorkflowNode) {
    changeGraph({
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === next.id ? next : node))
    });
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
  async function saveDraft(showSuccess = true): Promise<number> {
    if (!workflow) throw new Error("请先选择 Workflow");
    setSaving(true);
    try {
      const result = await updateWorkflowDraft(workflow.id, workflow.draftRevision, graph);
      setWorkflow({ ...workflow, draftRevision: result.draftRevision, draftGraph: graph });
      setWorkflows((items) =>
        items.map((item) =>
          item.id === workflow.id ? { ...item, draftRevision: result.draftRevision } : item
        )
      );
      setDirty(false);
      if (showSuccess) message.success("草稿已保存");
      return result.draftRevision;
    } finally {
      setSaving(false);
    }
  }

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
      const result = await publishWorkflow(workflow.id, revision);
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
      await refreshList();
      await openWorkflow(created.id);
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
        }
      }
    });
  }

  return (
    <section className="workspace workflowWorkspace">
      <header className="compactPageHeader workflowPageHeader">
        <div>
          <h1>Workflow 编排</h1>
          <p>构建确定性 Agent 流程，校验后发布为不可变版本。</p>
        </div>
        <Space size={8}>
          <WorkflowGuide />
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setCreateOpen(true)}>
            新建 Workflow
          </Button>
        </Space>
      </header>

      <div className="workflowWorkbench">
        <WorkflowSidebar
          loading={loading}
          selectedId={workflow?.id ?? null}
          workflows={workflows}
          onArchive={confirmArchive}
          onCreate={() => setCreateOpen(true)}
          onSelect={requestOpenWorkflow}
        />

        {workflow ? (
          <main className="workflowEditor">
            <header className="workflowToolbar">
              <div className="workflowToolbarTitle">
                <strong>{workflow.name}</strong>
                <Tag color={workflow.status === "PUBLISHED" ? "green" : "default"}>
                  {workflow.publishedVersion ? `已发布 v${workflow.publishedVersion}` : "未发布"}
                </Tag>
                <span>{dirty ? "有未保存修改" : `草稿 r${workflow.draftRevision}`}</span>
              </div>
              <Space wrap size={8}>
                <Button
                  disabled={!workflow}
                  icon={<HistoryOutlined />}
                  onClick={() => setTraceOpen(true)}
                >
                  Trace
                </Button>
                <Button
                  icon={<CheckOutlined />}
                  loading={saving}
                  onClick={() => void runValidation()}
                >
                  校验
                </Button>
                <Button
                  icon={<SaveOutlined />}
                  loading={saving}
                  onClick={() => void saveDraftWithFeedback()}
                >
                  保存
                </Button>
                <Button
                  icon={<CloudUploadOutlined />}
                  loading={saving}
                  type="primary"
                  onClick={() => void publish()}
                >
                  发布
                </Button>
              </Space>
            </header>
            <div className="workflowEditorBody">
              <NodePalette onAdd={addNode} />
              <div className="workflowCanvasRegion">
                <WorkflowCanvas
                  graph={graph}
                  issues={issues}
                  selectedNodeId={selectedNodeId}
                  traceStatuses={traceStatuses}
                  onConnectionRejected={(reason) => message.warning(reason)}
                  onGraphChange={changeGraph}
                  onSelectNode={setSelectedNodeId}
                />
                <ValidationPanel
                  issues={issues}
                  valid={validationValid}
                  onSelectNode={setSelectedNodeId}
                />
              </div>
              <NodeInspector
                node={selectedNode}
                resources={resources}
                onChange={updateNode}
                onDelete={deleteNode}
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
