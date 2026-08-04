/** 编译后变量引用允许访问的上下文根命名空间。 */
export type WorkflowReferenceSource = "input" | "nodes" | "runtime";

/** 已解析为静态路径的变量引用，Runtime 不再解析原始表达式字符串。 */
export type CompiledReference = {
  /** 编译值类型判别字段。 */
  kind: "reference";
  /** 引用来自 Start 输入、节点输出或 Runtime 上下文。 */
  source: WorkflowReferenceSource;
  /** 去除根命名空间后的静态属性路径。 */
  path: string[];
};

/** 由普通文本片段和变量引用组成的编译模板。 */
export type CompiledTemplate = {
  /** 编译值类型判别字段。 */
  kind: "template";
  /** 按原始顺序排列的文本和引用片段。 */
  segments: Array<string | CompiledReference>;
};

/** Runtime 可以安全求值的递归 JSON 值和受控表达式。 */
export type CompiledValue =
  | string
  | number
  | boolean
  | null
  | CompiledReference
  | CompiledTemplate
  | CompiledValue[]
  | { [key: string]: CompiledValue };

/** 编译计划中的节点，不再包含画布坐标等编辑器信息。 */
export type CompiledWorkflowNode = {
  /** 原 Graph 节点 ID。 */
  id: string;
  /** 节点执行器类型。 */
  type: string;
  /** Run Trace 展示名称。 */
  name: string;
  /** 已递归编译变量引用的节点配置。 */
  config: { [key: string]: CompiledValue };
};

/** 编译计划中从当前节点出发的一条边。 */
export type CompiledWorkflowEdge = {
  /** 原 Graph 连线 ID。 */
  id: string;
  /** 下一个节点 ID。 */
  target: string;
  /** Condition 分支 Handle。 */
  sourceHandle?: string;
};

/** Start 节点声明的单个 Workflow 输入。 */
export type WorkflowInputDefinition = {
  /** 输入变量名。 */
  name: string;
  /** Runtime 支持的 JSON 数据类型。 */
  type: "string" | "number" | "boolean" | "object" | "array";
  /** 运行前是否必须提供该输入。 */
  required: boolean;
  /** 调用方未提供输入时使用的默认值。 */
  defaultValue?: unknown;
};

/** 发布版本或草稿测试实际执行的可信编译计划。 */
export type CompiledWorkflowPlan = {
  /** 编译计划 Schema 版本。 */
  schemaVersion: 1;
  /** 唯一 Start 节点 ID。 */
  startNodeId: string;
  /** 用于确定性调度和引用检查的节点拓扑顺序。 */
  topologicalOrder: string[];
  /** 按节点 ID 索引的编译节点。 */
  nodes: Record<string, CompiledWorkflowNode>;
  /** 按起点节点 ID 索引的出边。 */
  outgoingEdges: Record<string, CompiledWorkflowEdge[]>;
  /** 运行开始前必须提供的 Start 输入。 */
  requiredInputs: WorkflowInputDefinition[];
  /** 编译时资源指纹，用于发现模型、知识库或工具配置漂移。 */
  resourceFingerprints: Record<string, string>;
};
