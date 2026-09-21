import type { WorkflowGraph } from "../types";

const HORIZONTAL_GAP = 260;
const VERTICAL_GAP = 140;
const ROW_GAP = 90;
const MAX_COLUMNS = 6; // 每行最多放置 6 个拓扑层级
const ORIGIN_X = 80;
const ORIGIN_Y = 110;

/**
 * 按依赖层级紧凑排列节点；同层节点纵向展开，长主链达到列上限后自动换行。
 * 这里只更新编辑器坐标，不改变节点、连线或分支语义。
 */
export function autoLayoutWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const originalOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  const incoming = new Map<
    string,
    Array<{ source: string; sourceHandle?: string; edgeOrder: number }>
  >();

  for (const [edgeOrder, edge] of graph.edges.entries()) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge.target);
    incoming.set(edge.target, [
      ...(incoming.get(edge.target) ?? []),
      { source: edge.source, sourceHandle: edge.sourceHandle, edgeOrder }
    ]);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const rank = new Map<string, number>();
  const queue = graph.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  for (const id of queue) rank.set(id, 0);

  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index];
    const sourceRank = rank.get(source) ?? 0;
    for (const target of outgoing.get(source) ?? []) {
      rank.set(target, Math.max(rank.get(target) ?? 0, sourceRank + 1));
      const nextIndegree = (indegree.get(target) ?? 1) - 1;
      indegree.set(target, nextIndegree);
      if (nextIndegree === 0) queue.push(target);
    }
  }

  // 编译器会拒绝环路；编辑阶段仍把环路节点放到末列，避免自动布局时节点重叠。
  const lastRank = Math.max(0, ...rank.values());
  for (const node of graph.nodes) {
    if (!rank.has(node.id)) rank.set(node.id, lastRank + 1);
  }

  const layers = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const nodeRank = rank.get(node.id) ?? 0;
    layers.set(nodeRank, [...(layers.get(nodeRank) ?? []), node.id]);
  }
  const maxRank = Math.max(0, ...rank.values());

  // 逐层按父节点轨道和 Condition 分支顺序排序，避免父子轨道上下颠倒形成 X 型交叉。
  const orderInLayer = new Map<string, number>();
  for (let nodeRank = 0; nodeRank <= maxRank; nodeRank += 1) {
    const layer = layers.get(nodeRank) ?? [];
    layer.sort((left, right) => {
      const scoreDifference =
        nodeOrderingScore(left, incoming, nodeById, orderInLayer) -
        nodeOrderingScore(right, incoming, nodeById, orderInLayer);
      return scoreDifference || (originalOrder.get(left) ?? 0) - (originalOrder.get(right) ?? 0);
    });
    layer.forEach((id, index) => orderInLayer.set(id, index));
  }

  const positions = new Map<string, { x: number; y: number }>();
  let rowTop = ORIGIN_Y;

  for (let row = 0; row <= Math.floor(maxRank / MAX_COLUMNS); row += 1) {
    const firstRank = row * MAX_COLUMNS;
    const rowRanks = Array.from(
      { length: Math.min(MAX_COLUMNS, maxRank - firstRank + 1) },
      (_, index) => firstRank + index
    );
    const rowLayerSize = Math.max(
      1,
      ...rowRanks.map((nodeRank) => layers.get(nodeRank)?.length ?? 0)
    );
    const rowHeight = (rowLayerSize - 1) * VERTICAL_GAP;

    for (const nodeRank of rowRanks) {
      const layer = layers.get(nodeRank) ?? [];
      const verticalOffset = ((rowLayerSize - layer.length) * VERTICAL_GAP) / 2;
      layer.forEach((id, index) => {
        positions.set(id, {
          x: ORIGIN_X + (nodeRank % MAX_COLUMNS) * HORIZONTAL_GAP,
          y: rowTop + verticalOffset + index * VERTICAL_GAP
        });
      });
    }
    rowTop += rowHeight + VERTICAL_GAP + ROW_GAP;
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, position: positions.get(node.id) }))
  };
}

/** 父节点位置是主排序键，Condition 的 handle 顺序用于稳定展开同源分支。 */
function nodeOrderingScore(
  nodeId: string,
  incoming: Map<string, Array<{ source: string; sourceHandle?: string; edgeOrder: number }>>,
  nodeById: Map<string, WorkflowGraph["nodes"][number]>,
  orderInLayer: Map<string, number>
) {
  const parentEdges = incoming.get(nodeId) ?? [];
  if (parentEdges.length === 0) return 0;
  const scores = parentEdges.map(({ source, sourceHandle, edgeOrder }) => {
    const parentOrder = orderInLayer.get(source) ?? 0;
    const sourceNode = nodeById.get(source);
    return parentOrder * 1000 + conditionBranchOrder(sourceNode, sourceHandle, edgeOrder);
  });
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

function conditionBranchOrder(
  node: WorkflowGraph["nodes"][number] | undefined,
  sourceHandle: string | undefined,
  edgeOrder: number
) {
  if (node?.type !== "condition") return edgeOrder / 1000;
  const branches = Array.isArray(node.config.branches) ? node.config.branches : [];
  const branchIndex = branches.findIndex(
    (branch) =>
      branch &&
      typeof branch === "object" &&
      String((branch as { handle?: unknown }).handle ?? "") === sourceHandle
  );
  if (branchIndex >= 0) return branchIndex;
  return branches.length + edgeOrder / 1000;
}
