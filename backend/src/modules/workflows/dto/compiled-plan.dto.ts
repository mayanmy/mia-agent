export type WorkflowReferenceSource = "input" | "nodes" | "runtime";

export type CompiledReference = {
  kind: "reference";
  source: WorkflowReferenceSource;
  path: string[];
};

export type CompiledTemplate = {
  kind: "template";
  segments: Array<string | CompiledReference>;
};

export type CompiledValue =
  | string
  | number
  | boolean
  | null
  | CompiledReference
  | CompiledTemplate
  | CompiledValue[]
  | { [key: string]: CompiledValue };

export type CompiledWorkflowNode = {
  id: string;
  type: string;
  name: string;
  config: { [key: string]: CompiledValue };
};

export type CompiledWorkflowEdge = {
  id: string;
  target: string;
  sourceHandle?: string;
};

export type WorkflowInputDefinition = {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  defaultValue?: unknown;
};

export type CompiledWorkflowPlan = {
  schemaVersion: 1;
  startNodeId: string;
  topologicalOrder: string[];
  nodes: Record<string, CompiledWorkflowNode>;
  outgoingEdges: Record<string, CompiledWorkflowEdge[]>;
  requiredInputs: WorkflowInputDefinition[];
  resourceFingerprints: Record<string, string>;
};
