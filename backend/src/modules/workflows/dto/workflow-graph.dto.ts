export const WORKFLOW_NODE_TYPES = [
  "start",
  "llm",
  "retrieval",
  "tool",
  "condition",
  "template",
  "end"
] as const;

export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export type WorkflowNode = {
  id: string;
  type: WorkflowNodeType;
  name: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
};

export type WorkflowGraph = {
  schemaVersion: 1;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};
