import type { WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNodePosition } from "../types";

const HORIZONTAL_NODE_GAP = 280;
const VERTICAL_COLLISION_OFFSET = 140;
const COLLISION_DISTANCE = 100;

/** 在指定节点出口追加节点，并自动创建连接。 */
export function appendNodeToGraph(
  graph: WorkflowGraph,
  sourceNodeId: string,
  sourceHandle: string | undefined,
  node: WorkflowNode
): WorkflowGraph {
  const source = graph.nodes.find((item) => item.id === sourceNodeId);
  if (!source) return graph;
  const edge = createEdge(sourceNodeId, node.id, sourceHandle);
  return {
    ...graph,
    nodes: [...graph.nodes, { ...node, position: findAvailablePosition(graph, node.position) }],
    edges: [...graph.edges, edge]
  };
}

/** 用新节点原子替换一条边，并保留 Condition 的原始 sourceHandle。 */
export function insertNodeOnEdge(
  graph: WorkflowGraph,
  edgeId: string,
  node: WorkflowNode
): WorkflowGraph {
  const edge = graph.edges.find((item) => item.id === edgeId);
  if (!edge) return graph;
  const source = graph.nodes.find((item) => item.id === edge.source);
  const target = graph.nodes.find((item) => item.id === edge.target);
  if (!source || !target) return graph;

  const midpoint = {
    x: ((source.position?.x ?? 0) + (target.position?.x ?? 0)) / 2,
    y: ((source.position?.y ?? 0) + (target.position?.y ?? 0)) / 2
  };
  const positionedNode = {
    ...node,
    position: findAvailablePosition(graph, midpoint)
  };
  return {
    ...graph,
    nodes: [...graph.nodes, positionedNode],
    edges: [
      ...graph.edges.filter((item) => item.id !== edgeId),
      createEdge(edge.source, node.id, edge.sourceHandle),
      createEdge(node.id, edge.target)
    ]
  };
}

/** 为出口快捷添加计算默认位置。 */
export function getAppendPosition(
  graph: WorkflowGraph,
  sourceNodeId: string
): WorkflowNodePosition {
  const source = graph.nodes.find((item) => item.id === sourceNodeId);
  return findAvailablePosition(graph, {
    x: (source?.position?.x ?? 0) + HORIZONTAL_NODE_GAP,
    y: source?.position?.y ?? 0
  });
}

/** 判断指定出口是否已经存在连接。 */
export function hasOutgoingConnection(
  graph: WorkflowGraph,
  sourceNodeId: string,
  sourceHandle?: string
): boolean {
  return graph.edges.some(
    (edge) =>
      edge.source === sourceNodeId &&
      (edge.sourceHandle ?? undefined) === (sourceHandle || undefined)
  );
}

function createEdge(source: string, target: string, sourceHandle?: string): WorkflowEdge {
  return {
    id: `edge-${crypto.randomUUID()}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {})
  };
}

/** 通过向下偏移避免新节点覆盖现有节点。 */
function findAvailablePosition(
  graph: WorkflowGraph,
  preferred: WorkflowNodePosition | undefined
): WorkflowNodePosition {
  const initial = preferred ?? { x: 280, y: 100 };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = { x: initial.x, y: initial.y + attempt * VERTICAL_COLLISION_OFFSET };
    const occupied = graph.nodes.some((node) => {
      const position = node.position ?? { x: 0, y: 0 };
      return (
        Math.abs(position.x - candidate.x) < COLLISION_DISTANCE &&
        Math.abs(position.y - candidate.y) < COLLISION_DISTANCE
      );
    });
    if (!occupied) return candidate;
  }
  return initial;
}
