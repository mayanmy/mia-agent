import type { WorkflowGraph, WorkflowNode } from "../types";

/** Workflow 变量的基础值类型。 */
export type WorkflowValueType =
  "string" | "number" | "boolean" | "object" | "array" | "file" | "files" | "unknown";

/** 变量选择器展示的稳定描述。 */
export type WorkflowVariableDescriptor = {
  /** 变量表达式，也是菜单唯一键。 */
  expression: string;
  /** 面向管理员的变量名称。 */
  label: string;
  /** 变量值类型。 */
  type: WorkflowValueType;
  /** 来源节点 ID；Start 输入为空。 */
  sourceNodeId?: string;
};

/** 只返回当前节点的拓扑祖先变量，阻止选择自身或未来节点输出。 */
export function buildVariableCatalog(
  graph: WorkflowGraph,
  currentNodeId: string
): WorkflowVariableDescriptor[] {
  const ancestors = collectAncestors(graph, currentNodeId);
  const descriptors: WorkflowVariableDescriptor[] = [];
  const start = graph.nodes.find((node) => node.type === "start");
  if (start) descriptors.push(...startInputVariables(start));
  for (const node of graph.nodes) {
    if (ancestors.has(node.id) && node.type !== "start") {
      descriptors.push(...nodeOutputVariables(node));
    }
  }
  return descriptors;
}

/** 反向遍历有向边，收集当前节点的全部祖先。 */
function collectAncestors(graph: WorkflowGraph, nodeId: string): Set<string> {
  const ancestors = new Set<string>();
  const queue = graph.edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (ancestors.has(current)) continue;
    ancestors.add(current);
    queue.push(...graph.edges.filter((edge) => edge.target === current).map((edge) => edge.source));
  }
  return ancestors;
}

/** 兼容 Start 输入的数组定义与旧版对象定义。 */
function startInputVariables(node: WorkflowNode): WorkflowVariableDescriptor[] {
  const inputs = node.config.inputs;
  if (Array.isArray(inputs)) {
    return inputs.flatMap((input) => {
      if (!input || typeof input !== "object") return [];
      const record = input as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "";
      if (!name) return [];
      return [
        {
          expression: `{{input.${name}}}`,
          label: `用户输入 / ${String(record.label || name)}`,
          type: normalizeValueType(record.type)
        }
      ];
    });
  }
  if (inputs && typeof inputs === "object") {
    return Object.keys(inputs as Record<string, unknown>).map((name) => ({
      expression: `{{input.${name}}}`,
      label: `用户输入 / ${name}`,
      type: "unknown"
    }));
  }
  return [];
}

/** 根据现有 Runtime 输出契约生成节点变量。 */
function nodeOutputVariables(node: WorkflowNode): WorkflowVariableDescriptor[] {
  const prefix = `{{nodes.${node.id}.output`;
  const create = (path: string, type: WorkflowValueType): WorkflowVariableDescriptor => ({
    expression: `${prefix}.${path}}}`,
    label: `${node.name} / ${path}`,
    type,
    sourceNodeId: node.id
  });
  if (node.type === "retrieval") {
    return [
      create("query", "string"),
      create("chunks", "array"),
      create("sources", "array"),
      create("elapsedMs", "number")
    ];
  }
  if (node.type === "condition") return [create("matchedHandle", "string")];
  if (node.type === "tool") return [create("result", "unknown")];
  if (node.type === "llm" && node.config.responseFormat === "json_object") {
    return [create("structured", "object"), create("text", "string")];
  }
  return [create("text", "string")];
}

/** 将外部输入类型收敛到编辑器支持的白名单。 */
function normalizeValueType(value: unknown): WorkflowValueType {
  const allowed: WorkflowValueType[] = [
    "string",
    "number",
    "boolean",
    "object",
    "array",
    "file",
    "files",
    "unknown"
  ];
  return allowed.includes(value as WorkflowValueType) ? (value as WorkflowValueType) : "unknown";
}
