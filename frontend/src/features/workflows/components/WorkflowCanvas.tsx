import { useRef, useState, type KeyboardEvent } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type {
  WorkflowGraph,
  WorkflowNode,
  WorkflowTraceNodeStatus,
  WorkflowValidationIssue
} from "../types";
import { NODE_LABELS, validateConnection } from "../utils";

/** 传入 React Flow 自定义节点卡片的视图数据。 */
type WorkflowNodeData = {
  /** Mia Graph 中的原始节点。 */
  workflowNode: WorkflowNode;
  /** 关联校验问题数量。 */
  issueCount: number;
  /** Trace 回放时的节点执行状态。 */
  traceStatus?: WorkflowTraceNodeStatus;
};
/** React Flow 使用的 Workflow 节点类型。 */
type CanvasNode = Node<WorkflowNodeData, "workflow">;

/** Workflow 画布参数。 */
export type WorkflowCanvasProps = {
  /** 当前完整 Graph。 */
  graph: WorkflowGraph;
  /** 当前选中的节点 ID。 */
  selectedNodeId: string | null;
  /** 当前 Graph 的校验问题。 */
  issues: WorkflowValidationIssue[];
  /** 按节点 ID 索引的 Trace 回放状态。 */
  traceStatuses: Record<string, WorkflowTraceNodeStatus>;
  /** Graph 结构或节点位置变化回调。 */
  onGraphChange: (graph: WorkflowGraph) => void;
  /** 节点选择变化回调。 */
  onSelectNode: (nodeId: string | null) => void;
  /** 非法连接提示回调。 */
  onConnectionRejected: (message: string) => void;
};

/** 在 React Flow 上编辑 Mia Graph，并隔离画布视图状态与持久化 DTO。 */
export function WorkflowCanvas({
  graph,
  selectedNodeId,
  issues,
  traceStatuses,
  onGraphChange,
  onSelectNode,
  onConnectionRejected
}: WorkflowCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const activeSelectedEdgeId = graph.edges.some((edge) => edge.id === selectedEdgeId)
    ? selectedEdgeId
    : null;
  const nodes: CanvasNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: "workflow",
    position: node.position ?? { x: 0, y: 0 },
    selected: node.id === selectedNodeId,
    data: {
      workflowNode: node,
      issueCount: issues.filter((issue) => issue.nodeId === node.id).length,
      traceStatus: traceStatuses[node.id]
    }
  }));
  const edges: Edge[] = graph.edges.map((edge) => ({
    ...edge,
    interactionWidth: 24,
    selected: edge.id === activeSelectedEdgeId,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeWidth: 1.6 }
  }));

  /** React Flow change 先作用到视图模型，再投影回稳定的 Mia Graph DTO。 */
  function handleNodeChanges(changes: NodeChange<CanvasNode>[]) {
    // 选择态由页面单独管理，不能因为点击节点就把草稿误标记为已修改。
    const graphChanges = changes.filter(
      (change) => change.type === "position" || change.type === "remove"
    );
    if (graphChanges.length === 0) return;
    const next = applyNodeChanges(graphChanges, nodes);
    const remainingIds = new Set(next.map((node) => node.id));
    onGraphChange({
      ...graph,
      nodes: next.map((flowNode) => ({
        ...flowNode.data.workflowNode,
        position: flowNode.position
      })),
      edges: graph.edges.filter(
        (edge) => remainingIds.has(edge.source) && remainingIds.has(edge.target)
      )
    });
  }

  /** 删除连线只更新 Graph DTO，发布时仍由后端重新构建邻接表。 */
  function handleEdgeChanges(changes: EdgeChange<Edge>[]) {
    const removedIds = new Set(
      changes.filter((change) => change.type === "remove").map((change) => change.id)
    );
    // 选择事件不属于 Graph 修改，避免点击连线时把草稿误标记为未保存。
    if (removedIds.size === 0) return;
    onGraphChange({
      ...graph,
      edges: graph.edges.filter((edge) => !removedIds.has(edge.id))
    });
    setSelectedEdgeId(null);
  }

  /** macOS 点击连线后主动聚焦画布，确保 Backspace/Delete 事件不会丢失。 */
  function handleCanvasKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!activeSelectedEdgeId || (event.key !== "Backspace" && event.key !== "Delete")) return;
    event.preventDefault();
    event.stopPropagation();
    onGraphChange({
      ...graph,
      edges: graph.edges.filter((edge) => edge.id !== activeSelectedEdgeId)
    });
    setSelectedEdgeId(null);
  }

  /** 创建连线前先执行浏览器侧快速校验，再更新 Mia Graph。 */
  function handleConnect(connection: Connection) {
    const error = validateConnection(graph, connection);
    if (error) {
      onConnectionRejected(error);
      return;
    }
    onGraphChange({
      ...graph,
      edges: [
        ...graph.edges,
        {
          id: `edge-${crypto.randomUUID()}`,
          source: connection.source!,
          target: connection.target!,
          ...(connection.sourceHandle ? { sourceHandle: connection.sourceHandle } : {})
        }
      ]
    });
  }

  return (
    <div
      className="workflowCanvas"
      data-testid="workflow-canvas"
      ref={canvasRef}
      role="application"
      aria-label="Workflow 画布"
      tabIndex={0}
      onKeyDown={handleCanvasKeyDown}
    >
      <ReactFlow<CanvasNode, Edge>
        colorMode="light"
        deleteKeyCode={null}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.35}
        maxZoom={1.6}
        nodeTypes={{ workflow: WorkflowNodeCard }}
        nodes={nodes}
        onConnect={handleConnect}
        onEdgeClick={(_, edge) => {
          setSelectedEdgeId(edge.id);
          onSelectNode(null);
          canvasRef.current?.focus({ preventScroll: true });
        }}
        onEdgesChange={handleEdgeChanges}
        onNodeClick={(_, node) => {
          setSelectedEdgeId(null);
          onSelectNode(node.id);
        }}
        onNodesChange={handleNodeChanges}
        onPaneClick={() => {
          setSelectedEdgeId(null);
          onSelectNode(null);
        }}
      >
        <Background color="#d7dde7" gap={20} size={1} />
        <MiniMap pannable zoomable nodeColor={miniMapColor} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

/** 节点卡只展示执行语义和状态；业务配置全部留在右侧属性面板。 */
/** 将 Mia 节点、校验问题和 Trace 状态渲染为画布卡片。 */
function WorkflowNodeCard({ data, selected }: NodeProps<CanvasNode>) {
  const { workflowNode, issueCount, traceStatus } = data;
  const branches =
    workflowNode.type === "condition" && Array.isArray(workflowNode.config.branches)
      ? workflowNode.config.branches
          .map((branch) =>
            branch &&
            typeof branch === "object" &&
            typeof (branch as { handle?: unknown }).handle === "string"
              ? String((branch as { handle: string }).handle)
              : ""
          )
          .filter(Boolean)
      : [];
  const handles =
    workflowNode.type === "condition"
      ? [...branches, String(workflowNode.config.defaultHandle || "default")]
      : [""];

  return (
    <div
      className={`workflowNode workflowNode-${workflowNode.type}${selected ? " selected" : ""}${issueCount ? " invalid" : ""}${traceStatus ? ` trace-${traceStatus.toLowerCase()}` : ""}`}
    >
      {workflowNode.type !== "start" ? <Handle type="target" position={Position.Left} /> : null}
      <div className="workflowNodeType">{NODE_LABELS[workflowNode.type]}</div>
      <strong>{workflowNode.name}</strong>
      <code>{workflowNode.id}</code>
      {issueCount ? <span className="workflowNodeIssue">{issueCount}</span> : null}
      {traceStatus ? <span className="workflowNodeTrace">{traceStatus}</span> : null}
      {workflowNode.type !== "end"
        ? handles.map((handle, index) => (
            <Handle
              id={handle || undefined}
              key={handle || "default-source"}
              position={Position.Right}
              style={
                handles.length > 1
                  ? { top: `${((index + 1) / (handles.length + 1)) * 100}%` }
                  : undefined
              }
              title={handle || "下一步"}
              type="source"
            />
          ))
        : null}
    </div>
  );
}

/** 根据 Trace 或校验状态为小地图节点选择颜色。 */
function miniMapColor(node: Node<WorkflowNodeData>) {
  if (node.data.traceStatus === "FAILED") return "#d14343";
  if (node.data.traceStatus === "COMPLETED") return "#2f855a";
  if (node.data.traceStatus === "SKIPPED") return "#94a3b8";
  if (node.data.issueCount > 0) return "#d97706";
  return "#6b7a90";
}
