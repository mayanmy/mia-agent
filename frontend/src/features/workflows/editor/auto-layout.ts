import type { WorkflowGraph } from "../types";

// 间距按 160px 节点卡片尺寸预留连线通道；修改卡片尺寸时需要一起校准这些常量。
const HORIZONTAL_GAP = 260;
const VERTICAL_GAP = 140;
const ROW_GAP = 90;
// 限制单行拓扑深度，避免长主链被 fitView 压缩成无法阅读的一条横线。
const MAX_COLUMNS = 6;
const ORIGIN_X = 80;
const ORIGIN_Y = 110;

/**
 * 按依赖层级紧凑排列节点；同层节点纵向展开，长主链达到列上限后自动换行。
 * 这里只更新编辑器坐标，不改变节点、连线或分支语义。
 *
 * 布局分为三步：
 * 1. 使用 Kahn 拓扑遍历计算每个节点的最长路径层级；
 * 2. 根据父节点轨道和 Condition handle 顺序调整同层节点顺序，尽量减少交叉；
 * 3. 将层级分批映射到有限列数，并按当前行最宽分支动态计算行高。
 */
export function autoLayoutWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
  // 同时建立正向和反向邻接信息：正向用于拓扑层级，反向用于同层交叉优化。
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
    // 编辑阶段可能暂时存在悬空边；自动布局忽略它们，但不从原 Graph 中删除。
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge.target);
    incoming.set(edge.target, [
      ...(incoming.get(edge.target) ?? []),
      { source: edge.source, sourceHandle: edge.sourceHandle, edgeOrder }
    ]);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const rank = new Map<string, number>();
  // 所有入度为 0 的节点都是布局入口，因而孤立子图也能被纳入同一次排列。
  const queue = graph.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  for (const id of queue) rank.set(id, 0);

  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index];
    const sourceRank = rank.get(source) ?? 0;
    for (const target of outgoing.get(source) ?? []) {
      // 取所有父路径中的最大层级，保证任意父节点都位于子节点之前。
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

  // positions 单独构建，最后一次性投影回 DTO，避免排序过程修改业务节点对象。
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
    // 当前行按分支最多的层级预留高度，避免下一行穿过尚未展开完的分支。
    const rowHeight = (rowLayerSize - 1) * VERTICAL_GAP;

    for (const nodeRank of rowRanks) {
      const layer = layers.get(nodeRank) ?? [];
      // 节点较少的层在本行垂直居中，分支关系比全部顶对齐更容易扫描。
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

/**
 * 父节点位置是主排序键，Condition 的 handle 顺序用于稳定展开同源分支。
 * 1000 倍权重确保“跟随父轨道”优先于分支细排；多父节点取平均值，相当于轻量的
 * barycenter crossing reduction，避免引入 ELK/Dagre 仍能覆盖常见 Workflow DAG。
 */
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
  // 普通节点没有业务分支顺序，使用原始边序作为稳定且影响极小的兜底排序键。
  if (node?.type !== "condition") return edgeOrder / 1000;
  const branches = Array.isArray(node.config.branches) ? node.config.branches : [];
  const branchIndex = branches.findIndex(
    (branch) =>
      branch &&
      typeof branch === "object" &&
      String((branch as { handle?: unknown }).handle ?? "") === sourceHandle
  );
  if (branchIndex >= 0) return branchIndex;
  // default handle 或历史脏数据统一排在显式分支之后，且继续保持原边顺序。
  return branches.length + edgeOrder / 1000;
}
