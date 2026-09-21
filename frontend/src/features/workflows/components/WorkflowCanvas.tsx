import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PlusOutlined } from "@ant-design/icons";
import { Button, Dropdown, type MenuProps } from "antd";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  getSmoothStepPath,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type {
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeType,
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
  /** 从指定出口追加节点。 */
  onAppendNode: (
    sourceNodeId: string,
    sourceHandle: string | undefined,
    type: WorkflowNodeType
  ) => void;
};
/** React Flow 使用的 Workflow 节点类型。 */
type CanvasNode = Node<WorkflowNodeData, "workflow">;

/** 自定义连线携带的快捷插入动作。 */
type WorkflowEdgeData = Record<string, unknown> & {
  /** 在当前连线中间插入节点。 */
  onInsertNode: (edgeId: string, type: WorkflowNodeType) => void;
  /** 错开正交连线出口，防止复杂 Graph 的回程线路完全重叠。 */
  routeOffset: number;
};
/** React Flow 使用的 Workflow 连线类型。 */
type CanvasEdge = Edge<WorkflowEdgeData, "workflow">;

/** Workflow 画布参数。 */
export type WorkflowCanvasProps = {
  /** 当前完整 Graph。 */
  graph: WorkflowGraph;
  /** 自增时让画布重新适配全部节点，用于自动布局完成后的视口定位。 */
  fitViewRevision: number;
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
  /** 双击节点时打开其属性面板。 */
  onOpenNodeInspector: (nodeId: string) => void;
  /** 非法连接提示回调。 */
  onConnectionRejected: (message: string) => void;
  /** 从节点出口追加并连接新节点。 */
  onAppendNode: (
    sourceNodeId: string,
    sourceHandle: string | undefined,
    type: WorkflowNodeType
  ) => void;
  /** 在已有连线中间插入节点。 */
  onInsertNode: (edgeId: string, type: WorkflowNodeType) => void;
};

/** 快捷菜单不提供第二个开始节点。 */
const QUICK_ADD_TYPES: WorkflowNodeType[] = [
  "llm",
  "retrieval",
  "tool",
  "condition",
  "template",
  "end"
];
const QUICK_ADD_MENU_ITEMS: MenuProps["items"] = QUICK_ADD_TYPES.map((type) => ({
  key: type,
  label: NODE_LABELS[type]
}));
const WORKFLOW_EDGE_MARKER_END = { type: MarkerType.ArrowClosed } as const;
const WORKFLOW_EDGE_STYLE = { strokeWidth: 1.6 } as const;

/** React Flow 节点类型必须保持引用稳定，避免每次渲染重新注册。 */
const NODE_TYPES = {
  workflow: memo(WorkflowNodeCard, areWorkflowNodeCardPropsEqual)
};
/** React Flow 连线类型必须保持引用稳定。 */
const EDGE_TYPES = {
  workflow: memo(WorkflowQuickInsertEdge, areWorkflowEdgePropsEqual)
};

/** 在 React Flow 上编辑 Mia Graph，并隔离画布视图状态与持久化 DTO。 */
export function WorkflowCanvas({
  graph,
  fitViewRevision,
  selectedNodeId,
  issues,
  traceStatuses,
  onGraphChange,
  onSelectNode,
  onOpenNodeInspector,
  onConnectionRejected,
  onAppendNode,
  onInsertNode
}: WorkflowCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  // React Flow 实例只用于视口操作，不进入业务 Graph，避免持久化第三方运行时对象。
  const flowInstanceRef = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  // 拖动期间阻止父 Graph 投影覆盖本地坐标，否则受控节点会在 pointermove 中回弹。
  const draggingRef = useRef(false);
  const onAppendNodeRef = useRef(onAppendNode);
  const onInsertNodeRef = useRef(onInsertNode);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // 父页面的业务回调会随页面渲染产生新引用，通过稳定代理避免击穿节点和连线 memo。
  onAppendNodeRef.current = onAppendNode;
  onInsertNodeRef.current = onInsertNode;
  const handleAppendNode = useCallback<WorkflowNodeData["onAppendNode"]>(
    (sourceNodeId, sourceHandle, type) => onAppendNodeRef.current(sourceNodeId, sourceHandle, type),
    []
  );
  const handleInsertNode = useCallback<WorkflowEdgeData["onInsertNode"]>(
    (edgeId, type) => onInsertNodeRef.current(edgeId, type),
    []
  );
  const activeSelectedEdgeId = useMemo(
    () => (graph.edges.some((edge) => edge.id === selectedEdgeId) ? selectedEdgeId : null),
    [graph.edges, selectedEdgeId]
  );
  // 先将校验问题聚合为 O(1) 查询，避免每个节点重复扫描完整 issues 数组。
  const issueCountByNodeId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) {
      if (!issue.nodeId) continue;
      counts.set(issue.nodeId, (counts.get(issue.nodeId) ?? 0) + 1);
    }
    return counts;
  }, [issues]);
  // 持久化 DTO 只保存业务字段和坐标；这里将其投影成 React Flow 的视图节点。
  const projectedNodes: CanvasNode[] = useMemo(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type: "workflow",
        position: node.position ?? { x: 0, y: 0 },
        selected: node.id === selectedNodeId,
        data: {
          workflowNode: node,
          issueCount: issueCountByNodeId.get(node.id) ?? 0,
          traceStatus: traceStatuses[node.id],
          onAppendNode: handleAppendNode
        }
      })),
    [graph.nodes, handleAppendNode, issueCountByNodeId, selectedNodeId, traceStatuses]
  );
  // 拖动帧必须留在画布局部状态，不能逐帧触发页面 Undo、自动保存和属性面板重绘。
  const [nodes, setNodes, applyCanvasNodeChanges] = useNodesState<CanvasNode>(projectedNodes);

  // 服务端加载、Undo/Redo 和属性修改会刷新投影视图；拖动期间则由 React Flow 独占每帧坐标。
  useEffect(() => {
    if (!draggingRef.current) setNodes(projectedNodes);
  }, [projectedNodes, setNodes]);

  useEffect(() => {
    if (fitViewRevision === 0) return;
    // 等一帧让 React Flow 先测量自动布局后的节点，再基于新边界计算 viewport。
    const frame = window.requestAnimationFrame(() => {
      void flowInstanceRef.current?.fitView({ padding: 0.2, maxZoom: 1, duration: 280 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitViewRevision]);
  // routeOffset 由 Edge ID 稳定计算，只作为视图路由参数，不污染后端 Graph DTO。
  const edges: CanvasEdge[] = useMemo(
    () =>
      graph.edges.map((edge) => ({
        ...edge,
        interactionWidth: 24,
        selected: edge.id === activeSelectedEdgeId,
        type: "workflow",
        data: { onInsertNode: handleInsertNode, routeOffset: routeOffsetForEdge(edge.id) },
        markerEnd: WORKFLOW_EDGE_MARKER_END,
        style: WORKFLOW_EDGE_STYLE
      })),
    [graph.edges, activeSelectedEdgeId, handleInsertNode]
  );

  /** React Flow change 先作用到视图模型，再投影回稳定的 Mia Graph DTO。 */
  function handleNodeChanges(changes: NodeChange<CanvasNode>[]) {
    applyCanvasNodeChanges(changes);
    // 选择态由页面单独管理，不能因为点击节点就把草稿误标记为已修改。
    // 拖动帧只进入画布本地状态，只有 drag stop 才提交快照，避免父页面渲染和 Undo 栈污染。
    const graphChanges = changes.filter((change) => change.type === "remove");
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
  function handleEdgeChanges(changes: EdgeChange<CanvasEdge>[]) {
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
      <ReactFlow<CanvasNode, CanvasEdge>
        colorMode="light"
        deleteKeyCode={null}
        edges={edges}
        fitView
        // 小型 Graph 不自动放大节点；用户仍可通过缩放控件主动放大查看。
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.35}
        maxZoom={1.6}
        // 大型 Graph 只挂载视口内的节点与连线，减少平移缩放时的 DOM、布局和绘制开销。
        onlyRenderVisibleElements
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodes={nodes}
        panOnDrag
        zoomOnScroll
        onConnect={handleConnect}
        onInit={(instance) => {
          flowInstanceRef.current = instance;
        }}
        onEdgeClick={(_, edge) => {
          setSelectedEdgeId(edge.id);
          onSelectNode(null);
          canvasRef.current?.focus({ preventScroll: true });
        }}
        onEdgesChange={handleEdgeChanges}
        onNodeClick={(_, node) => {
          setSelectedEdgeId(null);
          onOpenNodeInspector(node.id);
        }}
        onNodeDoubleClick={(_, node) => {
          setSelectedEdgeId(null);
          onOpenNodeInspector(node.id);
        }}
        onNodeDragStart={() => {
          // 从此刻开始 React Flow 独占位置更新，父页面仍保留拖动前的可撤销快照。
          draggingRef.current = true;
        }}
        onNodeDragStop={(_, flowNode) => {
          draggingRef.current = false;
          // 松手后仅提交最终坐标，因此一次拖动只产生一个 Undo 快照和一次自动保存。
          onGraphChange({
            ...graph,
            nodes: graph.nodes.map((node) =>
              node.id === flowNode.id ? { ...node, position: flowNode.position } : node
            )
          });
        }}
        onNodesChange={handleNodeChanges}
        onPaneClick={() => {
          setSelectedEdgeId(null);
          onSelectNode(null);
        }}
      >
        <Background color="#c2c9d2" gap={12} size={1.2} variant={BackgroundVariant.Dots} />
        <MiniMap pannable zoomable nodeColor={miniMapColor} style={{ width: 128, height: 88 }} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

/** 将 Mia 节点、校验问题和 Trace 状态渲染为画布卡片。 */
function WorkflowNodeCard({ data, selected }: NodeProps<CanvasNode>) {
  const { workflowNode, issueCount, traceStatus, onAppendNode } = data;
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
        ? handles.map((handle, index) => {
            const top = `${((index + 1) / (handles.length + 1)) * 100}%`;
            return (
              <div
                className="workflowNodeOutput"
                key={handle || "default-source"}
                style={handles.length > 1 ? { top } : undefined}
              >
                <Handle
                  id={handle || undefined}
                  position={Position.Right}
                  title={handle || "下一步"}
                  type="source"
                />
                <NodeTypeMenuButton
                  title={handle ? `从 ${handle} 分支添加节点` : "添加下一节点"}
                  onSelect={(type) => onAppendNode(workflowNode.id, handle || undefined, type)}
                />
              </div>
            );
          })
        : null}
    </div>
  );
}

/** 节点只在自身内容、状态或选中态变化时重绘，其他节点更新不会穿透到当前卡片。 */
function areWorkflowNodeCardPropsEqual(
  previous: NodeProps<CanvasNode>,
  next: NodeProps<CanvasNode>
) {
  return (
    previous.selected === next.selected &&
    previous.data.workflowNode === next.data.workflowNode &&
    previous.data.issueCount === next.data.issueCount &&
    previous.data.traceStatus === next.data.traceStatus &&
    previous.data.onAppendNode === next.data.onAppendNode
  );
}

/** 在连线中点渲染快捷插入入口，并保留 React Flow 的完整交互宽度。 */
function WorkflowQuickInsertEdge(props: EdgeProps<CanvasEdge>) {
  const [hovered, setHovered] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 前向边使用固定短出口；自动布局换行造成的回程边才错开通道，避免无意义绕行。
  const [path, labelX, labelY] = getSmoothStepPath({
    ...props,
    borderRadius: 8,
    // 普通前向边走最短路径；只有换行产生的回程边才分配独立外侧通道。
    offset: props.sourceX >= props.targetX ? (props.data?.routeOffset ?? 20) : 20
  });
  const showInsertAction = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
    setHovered(true);
  };
  const scheduleHideInsertAction = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    // EdgeLabelRenderer 位于 HTML Portal，短暂延迟让指针可以从 SVG 连线移动到按钮。
    hideTimerRef.current = setTimeout(() => setHovered(false), 120);
  };
  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    []
  );
  const shouldRenderInsertAction = Boolean(props.selected || hovered);
  return (
    <>
      {/* Halo 在交叉处切断下层灰线；它不响应指针，真实交互由透明宽路径承担。 */}
      <path className="workflowEdgeHalo" d={path} fill="none" />
      <BaseEdge
        id={props.id}
        interactionWidth={0}
        markerEnd={props.markerEnd}
        path={path}
        style={props.style}
      />
      <path
        className="workflowEdgeHoverTarget"
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        onMouseEnter={showInsertAction}
        onMouseLeave={scheduleHideInsertAction}
      />
      {shouldRenderInsertAction ? (
        <EdgeLabelRenderer>
          <div
            className="workflowEdgeInsert nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onMouseEnter={showInsertAction}
            onMouseLeave={scheduleHideInsertAction}
          >
            <NodeTypeMenuButton
              title="在连线中插入节点"
              onSelect={(type) => props.data?.onInsertNode(props.id, type)}
            />
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

/** Edge ID 的稳定散列让通道分配不因删除相邻边而整体跳动。 */
function routeOffsetForEdge(edgeId: string) {
  let hash = 0;
  for (let index = 0; index < edgeId.length; index += 1) {
    hash = (hash * 31 + edgeId.charCodeAt(index)) >>> 0;
  }
  // 七条离散通道在可读性和占用空间之间折中；超过七条时允许复用并依赖高亮辨识。
  return 18 + (hash % 7) * 7;
}

/** Edge 只依赖路径坐标和插入动作，忽略 React Flow 传入但未参与渲染的其他字段。 */
function areWorkflowEdgePropsEqual(previous: EdgeProps<CanvasEdge>, next: EdgeProps<CanvasEdge>) {
  return (
    previous.id === next.id &&
    previous.sourceX === next.sourceX &&
    previous.sourceY === next.sourceY &&
    previous.targetX === next.targetX &&
    previous.targetY === next.targetY &&
    previous.sourcePosition === next.sourcePosition &&
    previous.targetPosition === next.targetPosition &&
    previous.selected === next.selected &&
    previous.markerEnd === next.markerEnd &&
    previous.style === next.style &&
    previous.data?.onInsertNode === next.data?.onInsertNode
  );
}

/** 节点类型快捷选择按钮。 */
type NodeTypeMenuButtonProps = {
  /** 按钮辅助说明。 */
  title: string;
  /** 选中节点类型回调。 */
  onSelect: (type: WorkflowNodeType) => void;
};

function NodeTypeMenuButtonComponent({ title, onSelect }: NodeTypeMenuButtonProps) {
  const [menuMounted, setMenuMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const button = (
    <Button
      aria-label={title}
      className="workflowQuickAddButton"
      icon={<PlusOutlined />}
      shape="circle"
      size="small"
      title={title}
      onFocus={() => setMenuMounted(true)}
      onMouseEnter={() => setMenuMounted(true)}
      onClick={(event) => {
        event.stopPropagation();
        // 触屏没有 hover，首次点击时同时挂载并打开菜单，避免需要点击两次。
        if (!menuMounted) {
          setMenuMounted(true);
          setMenuOpen(true);
        }
      }}
    />
  );

  // 初始只保留轻量按钮；用户表达交互意图后才创建 AntD Dropdown 及其菜单状态。
  if (!menuMounted) return button;
  return (
    <Dropdown
      destroyOnHidden
      menu={{
        items: QUICK_ADD_MENU_ITEMS,
        onClick: ({ key }) => {
          setMenuOpen(false);
          onSelect(key as WorkflowNodeType);
        }
      }}
      open={menuOpen}
      placement="bottomLeft"
      trigger={["click"]}
      onOpenChange={setMenuOpen}
    >
      {button}
    </Dropdown>
  );
}

// 按钮动作由所属节点/连线的稳定标识决定；标题不变时无需因闭包新引用重复渲染 AntD 菜单。
const NodeTypeMenuButton = memo(
  NodeTypeMenuButtonComponent,
  (previous, next) => previous.title === next.title
);

/** 根据 Trace 或校验状态为小地图节点选择颜色。 */
function miniMapColor(node: Node<WorkflowNodeData>) {
  if (node.data.traceStatus === "FAILED") return "#d14343";
  if (node.data.traceStatus === "COMPLETED") return "#2f855a";
  if (node.data.traceStatus === "SKIPPED") return "#94a3b8";
  if (node.data.issueCount > 0) return "#d97706";
  return "#cbd1db";
}
