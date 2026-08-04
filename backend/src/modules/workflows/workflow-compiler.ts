import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ModelConfigType } from "@prisma/client";

import { KnowledgeService } from "../knowledge/knowledge.service";
import { ModelProvidersService } from "../model-providers/model-providers.service";
import { ToolsService } from "../tools/tools.service";
import {
  CompiledReference,
  CompiledWorkflowNode,
  CompiledWorkflowPlan,
  WorkflowInputDefinition
} from "./dto/compiled-plan.dto";
import {
  WORKFLOW_NODE_TYPES,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeType
} from "./dto/workflow-graph.dto";
import { WorkflowValidationIssue, WorkflowValidationResult } from "./dto/workflow-validation.dto";
import { compileExpressionValue, WorkflowExpressionError } from "./expression-parser";

const MAX_NODES = 200;
const MAX_EDGES = 500;
const RUNTIME_FIELDS = new Set(["requestId", "userId", "agentId", "sessionId", "now"]);
const INPUT_TYPES = new Set(["string", "number", "boolean", "object", "array"]);
const CONDITION_OPERATORS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "exists"]);

/** Graph 完成基础解析后供各校验阶段复用的索引结构。 */
type ParsedGraph = {
  /** 已完成基础结构归一化的 Graph。 */
  graph: WorkflowGraph;
  /** 按节点 ID 索引的节点。 */
  nodeById: Map<string, WorkflowNode>;
  /** 按起点节点 ID 索引的出边。 */
  outgoing: Map<string, WorkflowEdge[]>;
  /** 按终点节点 ID 索引的入边。 */
  incoming: Map<string, WorkflowEdge[]>;
  /** DAG 的稳定拓扑顺序。 */
  topologicalOrder: string[];
  /** 唯一 Start 节点；校验失败前可能为空。 */
  startNode?: WorkflowNode;
  /** Graph 中的全部 End 节点。 */
  endNodes: WorkflowNode[];
};

@Injectable()
export class WorkflowCompiler {
  /** 资源检查只依赖所属模块的公开 Service，避免 Workflow 跨边界直接查表。 */
  constructor(
    private readonly modelProvidersService: ModelProvidersService,
    private readonly knowledgeService: KnowledgeService,
    private readonly toolsService: ToolsService
  ) {}

  /**
   * 编译分成纯图校验、表达式校验和资源校验三段。只有全部通过才返回可执行 Plan，
   * 避免 Runtime 在请求途中才发现草稿结构或资源已失效。
   */
  async compile(value: unknown): Promise<WorkflowValidationResult> {
    const issues: WorkflowValidationIssue[] = [];
    const parsed = this.parseGraph(value, issues);
    if (!parsed || this.hasErrors(issues)) return { valid: false, issues };

    this.validateGraphSemantics(parsed, issues);
    const compiledNodes = this.compileNodes(parsed, issues);
    if (this.hasErrors(issues)) return { valid: false, issues };

    const resourceFingerprints = await this.validateResources(parsed.graph.nodes, issues);
    if (this.hasErrors(issues)) return { valid: false, issues };

    const startNode = parsed.startNode!;
    const plan: CompiledWorkflowPlan = {
      schemaVersion: 1,
      startNodeId: startNode.id,
      topologicalOrder: parsed.topologicalOrder,
      nodes: compiledNodes,
      outgoingEdges: Object.fromEntries(
        parsed.graph.nodes.map((node) => [
          node.id,
          (parsed.outgoing.get(node.id) ?? []).map((edge) => ({
            id: edge.id,
            target: edge.target,
            ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {})
          }))
        ])
      ),
      requiredInputs: this.getStartInputs(startNode).filter((input) => input.required),
      resourceFingerprints
    };
    return {
      valid: true,
      issues,
      compiledPlan: plan,
      checksum: checksumJson(plan)
    };
  }

  /** 将不可信 JSON 转为内部 Graph，并一次收集可定位的 Schema 与重复 ID 问题。 */
  private parseGraph(value: unknown, issues: WorkflowValidationIssue[]): ParsedGraph | null {
    if (!this.isRecord(value)) {
      this.addIssue(issues, "GRAPH_INVALID", "graph 必须是对象");
      return null;
    }
    if (value.schemaVersion !== 1) {
      this.addIssue(issues, "SCHEMA_VERSION_UNSUPPORTED", "仅支持 schemaVersion=1");
    }
    if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
      this.addIssue(issues, "GRAPH_INVALID", "graph 必须包含 nodes 和 edges 数组");
      return null;
    }
    if (value.nodes.length > MAX_NODES || value.edges.length > MAX_EDGES) {
      this.addIssue(
        issues,
        "GRAPH_TOO_LARGE",
        `graph 不能超过 ${MAX_NODES} 个节点和 ${MAX_EDGES} 条边`
      );
    }

    const nodes = value.nodes.flatMap((item, index) => {
      const node = this.parseNode(item, index, issues);
      return node ? [node] : [];
    });
    const edges = value.edges.flatMap((item, index) => {
      const edge = this.parseEdge(item, index, issues);
      return edge ? [edge] : [];
    });
    const graph: WorkflowGraph = { schemaVersion: 1, nodes, edges };
    const nodeById = new Map<string, WorkflowNode>();
    for (const node of nodes) {
      if (nodeById.has(node.id)) {
        this.addIssue(issues, "NODE_ID_DUPLICATED", `节点 ID 重复: ${node.id}`, node.id);
      } else {
        nodeById.set(node.id, node);
      }
    }

    const edgeIds = new Set<string>();
    const outgoing = new Map<string, WorkflowEdge[]>();
    const incoming = new Map<string, WorkflowEdge[]>();
    for (const edge of edges) {
      if (edgeIds.has(edge.id)) {
        this.addIssue(issues, "EDGE_ID_DUPLICATED", `连线 ID 重复: ${edge.id}`);
      }
      edgeIds.add(edge.id);
      if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
        this.addIssue(issues, "EDGE_NODE_NOT_FOUND", `连线 ${edge.id} 引用了不存在的节点`);
        continue;
      }
      outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
      incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    }

    const starts = nodes.filter((node) => node.type === "start");
    const endNodes = nodes.filter((node) => node.type === "end");
    if (starts.length !== 1) {
      this.addIssue(issues, "START_NODE_COUNT_INVALID", "Workflow 必须且只能有一个 Start 节点");
    }
    if (endNodes.length === 0) {
      this.addIssue(issues, "END_NODE_MISSING", "Workflow 至少需要一个 End 节点");
    }

    const topologicalOrder = this.topologicalSort(nodes, outgoing, incoming);
    if (topologicalOrder.length !== nodes.length) {
      this.addIssue(issues, "GRAPH_CYCLE", "Workflow 不允许存在环路");
    }
    return {
      graph,
      nodeById,
      outgoing,
      incoming,
      topologicalOrder,
      startNode: starts[0],
      endNodes
    };
  }

  /** 节点解析只保留 V1 Runtime 认识的字段，position 仅供草稿回显且不会进入 Plan。 */
  private parseNode(
    value: unknown,
    index: number,
    issues: WorkflowValidationIssue[]
  ): WorkflowNode | null {
    if (!this.isRecord(value)) {
      this.addIssue(issues, "NODE_INVALID", `nodes[${index}] 必须是对象`);
      return null;
    }
    const id = this.nonEmptyString(value.id);
    const type = this.nonEmptyString(value.type);
    const name = this.nonEmptyString(value.name);
    if (!id || !type || !name || !this.isRecord(value.config)) {
      this.addIssue(issues, "NODE_INVALID", `nodes[${index}] 必须包含 id、type、name 和 config`);
      return null;
    }
    if (!WORKFLOW_NODE_TYPES.includes(type as WorkflowNodeType)) {
      this.addIssue(issues, "NODE_TYPE_UNSUPPORTED", `不支持的节点类型: ${type}`, id, "type");
      return null;
    }
    return {
      id,
      type: type as WorkflowNodeType,
      name,
      config: value.config,
      ...(this.isPosition(value.position) ? { position: value.position } : {})
    };
  }

  /** 边在进入图算法前完成字段归一化，避免空 Handle 被误认为默认分支。 */
  private parseEdge(
    value: unknown,
    index: number,
    issues: WorkflowValidationIssue[]
  ): WorkflowEdge | null {
    if (!this.isRecord(value)) {
      this.addIssue(issues, "EDGE_INVALID", `edges[${index}] 必须是对象`);
      return null;
    }
    const id = this.nonEmptyString(value.id);
    const source = this.nonEmptyString(value.source);
    const target = this.nonEmptyString(value.target);
    const sourceHandle =
      value.sourceHandle === undefined ? undefined : this.nonEmptyString(value.sourceHandle);
    if (!id || !source || !target || (value.sourceHandle !== undefined && !sourceHandle)) {
      this.addIssue(
        issues,
        "EDGE_INVALID",
        `edges[${index}] 必须包含 id、source、target，sourceHandle 如存在则不能为空`
      );
      return null;
    }
    return { id, source, target, ...(sourceHandle ? { sourceHandle } : {}) };
  }

  /** 校验可达性、终止性和出边规则，确保 Runtime 不会执行到悬空路径。 */
  private validateGraphSemantics(parsed: ParsedGraph, issues: WorkflowValidationIssue[]): void {
    const start = parsed.startNode;
    if (!start) return;
    if ((parsed.incoming.get(start.id) ?? []).length > 0) {
      this.addIssue(issues, "START_HAS_INCOMING", "Start 节点不能有入边", start.id);
    }
    for (const end of parsed.endNodes) {
      if ((parsed.outgoing.get(end.id) ?? []).length > 0) {
        this.addIssue(issues, "END_HAS_OUTGOING", "End 节点不能有出边", end.id);
      }
    }
    for (const node of parsed.graph.nodes) {
      const outgoing = parsed.outgoing.get(node.id) ?? [];
      if (node.type !== "condition" && node.type !== "end" && outgoing.length > 1) {
        this.addIssue(
          issues,
          "MULTIPLE_DEFAULT_EDGES",
          "非 Condition 节点最多只能有一条默认出边",
          node.id
        );
      }
      if (node.type !== "condition" && outgoing.some((edge) => edge.sourceHandle)) {
        this.addIssue(
          issues,
          "EDGE_HANDLE_NOT_ALLOWED",
          "只有 Condition 节点的出边可以配置 sourceHandle",
          node.id
        );
      }
    }

    const reachable = this.walk(start.id, parsed.outgoing, (edge) => edge.target);
    for (const node of parsed.graph.nodes) {
      if (!reachable.has(node.id)) {
        this.addIssue(issues, "NODE_UNREACHABLE", "节点无法从 Start 到达", node.id);
      }
    }
    const canReachEnd = new Set<string>();
    for (const end of parsed.endNodes) {
      for (const id of this.walk(end.id, parsed.incoming, (edge) => edge.source))
        canReachEnd.add(id);
    }
    for (const node of parsed.graph.nodes) {
      if (!canReachEnd.has(node.id)) {
        this.addIssue(issues, "PATH_WITHOUT_END", "节点不存在通往 End 的路径", node.id);
      }
    }
    this.validateNodeConfigs(parsed, issues);
  }

  /** 按节点类型检查最小必需配置，复杂值留给表达式编译阶段处理。 */
  private validateNodeConfigs(parsed: ParsedGraph, issues: WorkflowValidationIssue[]): void {
    for (const node of parsed.graph.nodes) {
      if (node.type === "start") this.validateStartConfig(node, issues);
      if (node.type === "llm") {
        this.requireConfigString(node, "modelConfigId", issues);
        this.requireConfigString(node, "prompt", issues);
        this.optionalConfigString(node, "systemPrompt", issues);
        this.optionalNumberRange(node, "temperature", 0, 2, issues);
        this.optionalPositiveInteger(node, "maxTokens", issues);
        this.optionalPositiveNumber(node, "timeoutSeconds", issues);
        if (
          node.config.responseFormat !== undefined &&
          node.config.responseFormat !== "text" &&
          node.config.responseFormat !== "json_object"
        ) {
          this.addIssue(
            issues,
            "NODE_CONFIG_INVALID",
            "responseFormat 只支持 text 或 json_object",
            node.id,
            "responseFormat"
          );
        }
      }
      if (node.type === "retrieval") {
        this.requireStringArray(node, "knowledgeBaseIds", issues);
        this.requireConfigString(node, "query", issues);
        this.optionalPositiveInteger(node, "topK", issues);
        this.optionalNumberRange(node, "scoreThreshold", 0, 1, issues);
      }
      if (node.type === "tool") {
        this.requireConfigString(node, "toolId", issues);
        if (!this.isRecord(node.config.arguments)) {
          this.addIssue(
            issues,
            "NODE_CONFIG_INVALID",
            "arguments 必须是对象",
            node.id,
            "arguments"
          );
        }
        this.optionalPositiveNumber(node, "timeoutSeconds", issues);
        if (
          node.config.failurePolicy !== undefined &&
          node.config.failurePolicy !== "fail" &&
          node.config.failurePolicy !== "continue"
        ) {
          this.addIssue(
            issues,
            "NODE_CONFIG_INVALID",
            "failurePolicy 只支持 fail 或 continue",
            node.id,
            "failurePolicy"
          );
        }
      }
      if (node.type === "template") this.requireConfigString(node, "template", issues);
      if (node.type === "condition") this.validateConditionConfig(node, parsed, issues);
      if (node.type === "end" && !this.isRecord(node.config.output)) {
        this.addIssue(issues, "NODE_CONFIG_INVALID", "output 必须是对象", node.id, "output");
      }
    }
  }

  /** Start 是所有 input 引用的声明源，因此名称、类型和 required 必须稳定。 */
  private validateStartConfig(node: WorkflowNode, issues: WorkflowValidationIssue[]): void {
    const inputs = node.config.inputs;
    if (!Array.isArray(inputs)) {
      this.addIssue(issues, "NODE_CONFIG_INVALID", "inputs 必须是数组", node.id, "inputs");
      return;
    }
    const names = new Set<string>();
    for (const [index, input] of inputs.entries()) {
      if (!this.isRecord(input) || !this.nonEmptyString(input.name)) {
        this.addIssue(
          issues,
          "NODE_CONFIG_INVALID",
          `inputs[${index}] 缺少 name`,
          node.id,
          "inputs"
        );
        continue;
      }
      const name = this.nonEmptyString(input.name)!;
      if (names.has(name)) {
        this.addIssue(issues, "INPUT_DUPLICATED", `输入变量重复: ${name}`, node.id, "inputs");
      }
      names.add(name);
      if (!INPUT_TYPES.has(String(input.type))) {
        this.addIssue(issues, "INPUT_TYPE_INVALID", `输入 ${name} 的 type 无效`, node.id, "inputs");
      }
      if (typeof input.required !== "boolean") {
        this.addIssue(
          issues,
          "NODE_CONFIG_INVALID",
          `输入 ${name} 的 required 必须是布尔值`,
          node.id,
          "inputs"
        );
      }
    }
  }

  /** Condition 使用结构化操作符和显式 Handle，禁止自由文本条件进入执行层。 */
  private validateConditionConfig(
    node: WorkflowNode,
    parsed: ParsedGraph,
    issues: WorkflowValidationIssue[]
  ): void {
    const branches = node.config.branches;
    if (!Array.isArray(branches) || branches.length === 0) {
      this.addIssue(issues, "NODE_CONFIG_INVALID", "branches 必须是非空数组", node.id, "branches");
      return;
    }
    const handles = new Set<string>();
    for (const branch of branches) {
      const handle = this.isRecord(branch) ? this.nonEmptyString(branch.handle) : null;
      if (!handle || handles.has(handle)) {
        this.addIssue(
          issues,
          "CONDITION_HANDLE_INVALID",
          "Condition 分支 handle 必须存在且唯一",
          node.id,
          "branches"
        );
      } else {
        handles.add(handle);
      }
      if (
        !this.isRecord(branch) ||
        branch.left === undefined ||
        !CONDITION_OPERATORS.has(String(branch.operator))
      ) {
        this.addIssue(
          issues,
          "CONDITION_BRANCH_INVALID",
          "Condition 分支必须包含 left 和受支持的 operator",
          node.id,
          "branches"
        );
      }
    }
    const defaultHandle = this.nonEmptyString(node.config.defaultHandle);
    if (!defaultHandle) {
      this.addIssue(
        issues,
        "CONDITION_DEFAULT_INVALID",
        "defaultHandle 不能为空",
        node.id,
        "defaultHandle"
      );
    }
    const validHandles = new Set(handles);
    if (defaultHandle) validHandles.add(defaultHandle);
    const edgeHandles = new Set<string>();
    for (const edge of parsed.outgoing.get(node.id) ?? []) {
      if (!edge.sourceHandle || !validHandles.has(edge.sourceHandle)) {
        this.addIssue(
          issues,
          "CONDITION_EDGE_INVALID",
          `Condition 出边 ${edge.id} 未绑定有效分支 handle`,
          node.id
        );
      } else if (edgeHandles.has(edge.sourceHandle)) {
        this.addIssue(
          issues,
          "CONDITION_EDGE_DUPLICATED",
          `分支 ${edge.sourceHandle} 最多只能有一条出边`,
          node.id
        );
      }
      if (edge.sourceHandle) edgeHandles.add(edge.sourceHandle);
    }
  }

  /** 编译节点配置并同时验证引用作用域，生成不含画布字段的执行节点。 */
  private compileNodes(
    parsed: ParsedGraph,
    issues: WorkflowValidationIssue[]
  ): Record<string, CompiledWorkflowNode> {
    const result: Record<string, CompiledWorkflowNode> = {};
    const startInputs = new Set(this.getStartInputs(parsed.startNode!).map((input) => input.name));
    const orderIndex = new Map(parsed.topologicalOrder.map((id, index) => [id, index]));
    const dominators = this.calculateDominators(parsed);
    for (const node of parsed.graph.nodes) {
      try {
        const compiled = compileExpressionValue(node.config);
        for (const reference of compiled.references) {
          this.validateReference(
            reference,
            node,
            parsed,
            startInputs,
            orderIndex,
            dominators,
            issues
          );
        }
        result[node.id] = {
          id: node.id,
          type: node.type,
          name: node.name,
          config: compiled.value as { [key: string]: never }
        };
      } catch (error) {
        this.addIssue(
          issues,
          "EXPRESSION_INVALID",
          error instanceof WorkflowExpressionError ? error.message : "表达式编译失败",
          node.id,
          "config"
        );
      }
    }
    return result;
  }

  /** 校验 input/runtime 白名单，并要求节点输出在所有入口路径上已经产生。 */
  private validateReference(
    reference: CompiledReference,
    node: WorkflowNode,
    parsed: ParsedGraph,
    startInputs: Set<string>,
    orderIndex: Map<string, number>,
    dominators: Map<string, Set<string>>,
    issues: WorkflowValidationIssue[]
  ): void {
    if (reference.source === "input" && !startInputs.has(reference.path[0])) {
      this.addIssue(
        issues,
        "INPUT_REFERENCE_UNKNOWN",
        `未声明输入变量: ${reference.path[0]}`,
        node.id,
        "config"
      );
    }
    if (reference.source === "runtime" && !RUNTIME_FIELDS.has(reference.path[0])) {
      this.addIssue(
        issues,
        "RUNTIME_REFERENCE_UNKNOWN",
        `不支持的 Runtime 变量: ${reference.path[0]}`,
        node.id,
        "config"
      );
    }
    if (reference.source === "nodes") {
      const sourceNodeId = reference.path[0];
      const sourceIndex = orderIndex.get(sourceNodeId);
      const currentIndex = orderIndex.get(node.id);
      if (!parsed.nodeById.has(sourceNodeId)) {
        this.addIssue(
          issues,
          "NODE_REFERENCE_UNKNOWN",
          `引用了不存在的节点: ${sourceNodeId}`,
          node.id,
          "config"
        );
      } else if (
        sourceIndex === undefined ||
        currentIndex === undefined ||
        sourceIndex >= currentIndex
      ) {
        this.addIssue(
          issues,
          "NODE_REFERENCE_NOT_PREVIOUS",
          `只能引用拓扑顺序中已执行的节点: ${sourceNodeId}`,
          node.id,
          "config"
        );
      } else if (!dominators.get(node.id)?.has(sourceNodeId)) {
        this.addIssue(
          issues,
          "BRANCH_REFERENCE_CONFLICT",
          `节点 ${sourceNodeId} 不会在当前节点的每条路径上执行`,
          node.id,
          "config"
        );
      }
    }
  }

  /** 通过所属模块公开服务校验资源，并仅持久化不含密钥的配置指纹。 */
  private async validateResources(
    nodes: WorkflowNode[],
    issues: WorkflowValidationIssue[]
  ): Promise<Record<string, string>> {
    const modelConfigIds = this.uniqueSorted(
      nodes.flatMap((node) =>
        node.type === "llm" && this.nonEmptyString(node.config.modelConfigId)
          ? [this.nonEmptyString(node.config.modelConfigId)!]
          : []
      )
    );
    const knowledgeBaseIds = this.uniqueSorted(
      nodes.flatMap((node) =>
        node.type === "retrieval" && Array.isArray(node.config.knowledgeBaseIds)
          ? node.config.knowledgeBaseIds.filter((id): id is string =>
              Boolean(this.nonEmptyString(id))
            )
          : []
      )
    );
    const toolIds = this.uniqueSorted(
      nodes.flatMap((node) =>
        node.type === "tool" && this.nonEmptyString(node.config.toolId)
          ? [this.nonEmptyString(node.config.toolId)!]
          : []
      )
    );

    const fingerprints: Record<string, string> = {};
    for (const modelConfigId of modelConfigIds) {
      try {
        await this.modelProvidersService.ensureEnabledModelConfig(
          modelConfigId,
          ModelConfigType.CHAT
        );
        const config = await this.modelProvidersService.getModelConfig(modelConfigId);
        // 指纹只包含运行相关非敏感字段，不能把 Provider Secret 写进版本快照。
        fingerprints[`model:${modelConfigId}`] = checksumJson({
          providerId: config.providerId,
          providerType: config.provider.providerType,
          baseUrl: config.provider.baseUrl,
          modelName: config.modelName,
          contextLength: config.contextLength,
          timeoutSeconds: config.timeoutSeconds,
          maxTokens: config.maxTokens
        });
      } catch {
        this.addIssue(
          issues,
          "MODEL_CONFIG_UNAVAILABLE",
          `Chat 模型配置不存在或已停用: ${modelConfigId}`
        );
      }
    }
    try {
      await this.knowledgeService.ensureKnowledgeBaseIdsExist(knowledgeBaseIds);
      const configs = await this.knowledgeService.getRetrievalConfigs(knowledgeBaseIds);
      for (const config of configs) {
        fingerprints[`knowledge:${config.id}`] = checksumJson(config);
      }
    } catch {
      this.addIssue(issues, "KNOWLEDGE_BASE_UNAVAILABLE", "知识库不存在或已停用");
    }
    let toolDefinitions: Awaited<ReturnType<ToolsService["getToolDefinitions"]>> = [];
    try {
      toolDefinitions = await this.toolsService.getToolDefinitions(toolIds);
    } catch {
      this.addIssue(issues, "TOOL_UNAVAILABLE", "工具定义读取失败");
    }
    const toolById = new Map(
      toolDefinitions.filter((tool) => tool.enabled).map((tool) => [tool.id, tool])
    );
    for (const toolId of toolIds) {
      if (!toolById.has(toolId)) {
        this.addIssue(issues, "TOOL_UNAVAILABLE", `工具不存在或已停用: ${toolId}`);
      }
    }
    for (const [id, definition] of toolById) {
      fingerprints[`tool:${id}`] = checksumJson(definition);
    }
    return Object.fromEntries(
      Object.entries(fingerprints).sort(([left], [right]) => left.localeCompare(right))
    );
  }

  /**
   * 节点引用必须被当前节点的所有入口路径支配。仅检查拓扑先后会允许跨 Condition
   * 分支读取一个并不一定执行过的节点，最终在 Runtime 形成偶发空值。
   */
  private calculateDominators(parsed: ParsedGraph): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    const allIds = new Set(parsed.graph.nodes.map((node) => node.id));
    for (const nodeId of parsed.topologicalOrder) {
      if (nodeId === parsed.startNode?.id) {
        result.set(nodeId, new Set([nodeId]));
        continue;
      }
      const predecessors = (parsed.incoming.get(nodeId) ?? []).map((edge) => edge.source);
      let common = new Set(allIds);
      for (const predecessor of predecessors) {
        const predecessorDominators = result.get(predecessor) ?? new Set<string>();
        common = new Set([...common].filter((id) => predecessorDominators.has(id)));
      }
      common.add(nodeId);
      result.set(nodeId, common);
    }
    return result;
  }

  /** Kahn 排序按画布节点原顺序稳定出队，使相同 Graph 始终生成相同 checksum。 */
  private topologicalSort(
    nodes: WorkflowNode[],
    outgoing: Map<string, WorkflowEdge[]>,
    incoming: Map<string, WorkflowEdge[]>
  ): string[] {
    const order = new Map(nodes.map((node, index) => [node.id, index]));
    const indegree = new Map(nodes.map((node) => [node.id, (incoming.get(node.id) ?? []).length]));
    const ready = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
    const result: string[] = [];
    while (ready.length > 0) {
      ready.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      const id = ready.shift()!;
      result.push(id);
      for (const edge of outgoing.get(id) ?? []) {
        const next = (indegree.get(edge.target) ?? 0) - 1;
        indegree.set(edge.target, next);
        if (next === 0) ready.push(edge.target);
      }
    }
    return result;
  }

  /** 正向或反向遍历共用该方法，分别计算 Start 可达和 End 可达集合。 */
  private walk(
    start: string,
    edges: Map<string, WorkflowEdge[]>,
    nextId: (edge: WorkflowEdge) => string
  ): Set<string> {
    const visited = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const edge of edges.get(id) ?? []) queue.push(nextId(edge));
    }
    return visited;
  }

  /** 只提取已通过类型校验的输入定义，防止无效草稿字段污染 Compiled Plan。 */
  private getStartInputs(node: WorkflowNode): WorkflowInputDefinition[] {
    if (!Array.isArray(node.config.inputs)) return [];
    return node.config.inputs.flatMap((value) => {
      if (!this.isRecord(value)) return [];
      const name = this.nonEmptyString(value.name);
      const type = String(value.type);
      if (!name || !INPUT_TYPES.has(type)) return [];
      return [
        {
          name,
          type: type as WorkflowInputDefinition["type"],
          required: value.required === true,
          ...(value.defaultValue !== undefined ? { defaultValue: value.defaultValue } : {})
        }
      ];
    });
  }

  /** 统一生成带节点和字段位置的必填字符串问题。 */
  private requireConfigString(
    node: WorkflowNode,
    field: string,
    issues: WorkflowValidationIssue[]
  ): void {
    if (!this.nonEmptyString(node.config[field])) {
      this.addIssue(issues, "NODE_CONFIG_INVALID", `${field} 不能为空`, node.id, field);
    }
  }

  /** 资源 ID 数组必须非空且每项可直接跨模块序列化。 */
  private requireStringArray(
    node: WorkflowNode,
    field: string,
    issues: WorkflowValidationIssue[]
  ): void {
    const value = node.config[field];
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.some((item) => !this.nonEmptyString(item))
    ) {
      this.addIssue(issues, "NODE_CONFIG_INVALID", `${field} 必须是非空字符串数组`, node.id, field);
    }
  }

  /** 可选字符串存在时也必须保持静态字符串类型。 */
  private optionalConfigString(
    node: WorkflowNode,
    field: string,
    issues: WorkflowValidationIssue[]
  ): void {
    const value = node.config[field];
    if (value !== undefined && typeof value !== "string") {
      this.addIssue(issues, "NODE_CONFIG_INVALID", `${field} 必须是字符串`, node.id, field);
    }
  }

  /** 浮点配置使用闭区间校验，不接受字符串形式数字。 */
  private optionalNumberRange(
    node: WorkflowNode,
    field: string,
    minimum: number,
    maximum: number,
    issues: WorkflowValidationIssue[]
  ): void {
    const value = node.config[field];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum)
    ) {
      this.addIssue(
        issues,
        "NODE_CONFIG_INVALID",
        `${field} 必须在 ${minimum}-${maximum} 之间`,
        node.id,
        field
      );
    }
  }

  /** Token 和 Top K 等计数配置必须为正整数。 */
  private optionalPositiveInteger(
    node: WorkflowNode,
    field: string,
    issues: WorkflowValidationIssue[]
  ): void {
    const value = node.config[field];
    if (value !== undefined && (!Number.isInteger(value) || Number(value) < 1)) {
      this.addIssue(issues, "NODE_CONFIG_INVALID", `${field} 必须是正整数`, node.id, field);
    }
  }

  /** 节点超时允许小数秒，但必须为有限正数。 */
  private optionalPositiveNumber(
    node: WorkflowNode,
    field: string,
    issues: WorkflowValidationIssue[]
  ): void {
    const value = node.config[field];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    ) {
      this.addIssue(issues, "NODE_CONFIG_INVALID", `${field} 必须是正数`, node.id, field);
    }
  }

  /** 所有编译问题经统一入口构造，保证 API 返回结构稳定。 */
  private addIssue(
    issues: WorkflowValidationIssue[],
    code: string,
    message: string,
    nodeId?: string,
    field?: string
  ): void {
    issues.push({
      code,
      severity: "error",
      message,
      ...(nodeId ? { nodeId } : {}),
      ...(field ? { field } : {})
    });
  }

  /** warning 不阻断发布，只有 error 会终止 Plan 生成。 */
  private hasErrors(issues: WorkflowValidationIssue[]): boolean {
    return issues.some((issue) => issue.severity === "error");
  }

  /** 归一化用户字符串字段，空白字符串按缺失处理。 */
  private nonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  /** JSON 对象必须排除数组，供 Graph 与节点配置校验复用。 */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  /** position 仅在坐标完整时保留，坏坐标不影响 Runtime 编译。 */
  private isPosition(value: unknown): value is { x: number; y: number } {
    return this.isRecord(value) && typeof value.x === "number" && typeof value.y === "number";
  }

  /** 资源列表去重并排序，确保校验顺序和指纹键顺序可复现。 */
  private uniqueSorted(values: string[]): string[] {
    return [...new Set(values)].sort();
  }
}

/** 对对象键递归排序后再计算摘要，保证相同 Plan 不受属性插入顺序影响。 */
/** 对递归排序后的 JSON 计算 SHA-256，确保相同计划得到稳定摘要。 */
export function checksumJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(value)))
    .digest("hex");
}

/** 对 JSON 容器递归排序对象键；数组顺序具有执行语义，因此保持不变。 */
/** 递归排序对象键，消除 JSON 属性插入顺序对 checksum 的影响。 */
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)])
    );
  }
  return value;
}
