/** Workflow V1 允许持久化和编译的节点类型白名单。 */
export const WORKFLOW_NODE_TYPES = [
  "start",
  "llm",
  "retrieval",
  "tool",
  "condition",
  "template",
  "end"
] as const;

/** Workflow 节点类型，由运行时白名单推导以避免字符串漂移。 */
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

/** 节点在画布中的坐标。 */
export type WorkflowNodePosition = {
  /** 相对画布左侧的横坐标。 */
  x: number;
  /** 相对画布顶部的纵坐标。 */
  y: number;
};

/** Workflow Graph 中的通用节点；具体 config 由节点类型对应的编译器校验。 */
export type WorkflowNode = {
  /** Graph 内稳定且唯一的节点 ID，也是变量引用路径的一部分。 */
  id: string;
  /** 决定配置校验和 Runtime Executor 的节点类型。 */
  type: WorkflowNodeType;
  /** 编辑器和 Run Trace 中展示的节点名称。 */
  name: string;
  /** 节点业务配置；发布时编译为不含可执行代码的结构化值。 */
  config: Record<string, unknown>;
  /** 编辑器画布坐标，不参与 Runtime 执行语义。 */
  position?: WorkflowNodePosition;
};

/** Workflow Graph 中的一条有向连接。 */
export type WorkflowEdge = {
  /** Graph 内稳定且唯一的连线 ID。 */
  id: string;
  /** 起点节点 ID。 */
  source: string;
  /** 终点节点 ID。 */
  target: string;
  /** Condition 等多出口节点的分支标识。 */
  sourceHandle?: string;
};

/** 前端保存和后端编译共同使用的 Workflow V1 Graph。 */
export type WorkflowGraph = {
  /** Graph 数据结构版本，用于后续兼容升级。 */
  schemaVersion: 1;
  /** Graph 中的全部节点。 */
  nodes: WorkflowNode[];
  /** Graph 中的全部有向连接。 */
  edges: WorkflowEdge[];
};
