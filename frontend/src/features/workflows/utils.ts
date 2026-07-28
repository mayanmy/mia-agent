import type { Connection } from "@xyflow/react";

import type { WorkflowGraph, WorkflowNode, WorkflowNodeType } from "./types";

export const NODE_LABELS: Record<WorkflowNodeType, string> = {
  start: "开始",
  llm: "模型",
  retrieval: "知识检索",
  tool: "工具",
  condition: "条件",
  template: "模板",
  end: "结束"
};

/** 新建 Workflow 直接提供可发布的最小 Start -> End 骨架。 */
export function createDefaultGraph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "start",
        type: "start",
        name: "开始",
        position: { x: 80, y: 180 },
        config: { inputs: [{ name: "query", type: "string", required: true }] }
      },
      {
        id: "end",
        type: "end",
        name: "结束",
        position: { x: 520, y: 180 },
        config: { output: { answer: "{{input.query}}" }, answer: "{{input.query}}" }
      }
    ],
    edges: [{ id: "edge-start-end", source: "start", target: "end" }]
  };
}

/** 节点默认配置只包含执行器需要的最小字段，资源 ID 由属性面板显式选择。 */
export function createWorkflowNode(type: WorkflowNodeType, index: number): WorkflowNode {
  const id = `${type}-${crypto.randomUUID()}`;
  const configs: Record<WorkflowNodeType, Record<string, unknown>> = {
    start: { inputs: [{ name: "query", type: "string", required: true }] },
    llm: { modelConfigId: "", prompt: "{{input.query}}", responseFormat: "text" },
    retrieval: { knowledgeBaseIds: [], query: "{{input.query}}", topK: 5 },
    tool: { toolId: "", arguments: {}, failurePolicy: "fail" },
    condition: {
      branches: [{ handle: "matched", left: "{{input.query}}", operator: "exists" }],
      defaultHandle: "default"
    },
    template: { template: "{{input.query}}" },
    end: { output: { answer: "{{input.query}}" }, answer: "{{input.query}}" }
  };
  return {
    id,
    type,
    name: NODE_LABELS[type],
    config: configs[type],
    position: { x: 280 + (index % 3) * 220, y: 100 + Math.floor(index / 3) * 150 }
  };
}

/** 在浏览器侧拦截明显非法连线，完整 DAG 语义仍交给后端编译器判定。 */
export function validateConnection(graph: WorkflowGraph, connection: Connection): string | null {
  const source = graph.nodes.find((node) => node.id === connection.source);
  const target = graph.nodes.find((node) => node.id === connection.target);
  if (!source || !target) return "连接的节点不存在";
  if (source.id === target.id) return "节点不能连接到自身";
  if (source.type === "end") return "结束节点不能有出边";
  if (target.type === "start") return "开始节点不能有入边";
  const handle = connection.sourceHandle ?? undefined;
  if (
    graph.edges.some(
      (edge) => edge.source === source.id && (edge.sourceHandle ?? undefined) === handle
    )
  ) {
    return source.type === "condition" ? "该条件分支已经连接" : "该节点已经有出边";
  }
  if (createsCycle(graph, source.id, target.id)) return "该连线会形成环路";
  return null;
}

/** 从目标节点向后搜索源节点，命中即说明新增边会形成环。 */
function createsCycle(graph: WorkflowGraph, sourceId: string, targetId: string): boolean {
  const pending = [targetId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === sourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of graph.edges) if (edge.source === current) pending.push(edge.target);
  }
  return false;
}
