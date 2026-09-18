import type { WorkflowGraph } from "../types";

const HORIZONTAL_GAP = 260;
const VERTICAL_GAP = 140;
const ORIGIN_X = 80;
const ORIGIN_Y = 110;

/**
 * 按依赖层级从左到右排列节点；同层节点垂直展开，并兼容孤立节点和意外环路。
 * 这里只更新编辑器坐标，不改变节点、连线或分支语义。
 */
export function autoLayoutWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge.target);
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
  const widestLayer = Math.max(1, ...[...layers.values()].map((layer) => layer.length));

  const positions = new Map<string, { x: number; y: number }>();
  for (const [nodeRank, layer] of layers) {
    const offset = ((widestLayer - layer.length) * VERTICAL_GAP) / 2;
    layer.forEach((id, index) => {
      positions.set(id, {
        x: ORIGIN_X + nodeRank * HORIZONTAL_GAP,
        y: ORIGIN_Y + offset + index * VERTICAL_GAP
      });
    });
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, position: positions.get(node.id) }))
  };
}
