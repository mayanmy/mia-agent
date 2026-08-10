import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, WorkflowStatus } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { createPageResult, normalizePageQuery } from "../../core/pagination";
import { PageResult } from "../../core/result";
import { PrismaService } from "../prisma/prisma.service";
import { ToolDefinition } from "../tools/dto/tool.dto";
import {
  WorkflowCreateDto,
  WorkflowDetail,
  WorkflowDraftUpdateDto,
  WorkflowDraftUpdateResult,
  WorkflowGraph,
  WorkflowListItem,
  WorkflowQueryDto,
  WorkflowUpdateDto
} from "./dto/workflow.dto";
import {
  PublishedWorkflowRuntimeConfig,
  PublishedWorkflowApp,
  PublishedWorkflowInput,
  WorkflowVersionDetail,
  WorkflowVersionListItem
} from "./dto/workflow-version.dto";
import {
  WorkflowPublishDto,
  WorkflowPublishResult,
  WorkflowValidateDto,
  WorkflowValidationResult
} from "./dto/workflow-validation.dto";
import { WorkflowCompiler } from "./workflow-compiler";

/** 转换 Workflow 列表 DTO 所需的最小数据库投影。 */
type WorkflowListRecord = {
  /** Workflow ID。 */
  id: string;
  /** Workflow 名称。 */
  name: string;
  /** Workflow 用途说明。 */
  description: string;
  /** 当前管理状态。 */
  status: WorkflowStatus;
  /** 当前草稿修订号。 */
  draftRevision: number;
  /** 最近发布版本号。 */
  publishedVersion: number | null;
  /** 创建管理员 ID。 */
  createdByUserId: string;
  /** 创建时间。 */
  createdAt: Date;
  /** 最近更新时间。 */
  updatedAt: Date;
};

/** 转换 Workflow 详情 DTO 所需的数据库投影。 */
type WorkflowDetailRecord = WorkflowListRecord & {
  /** 数据库中保存的 JSON Graph。 */
  draftGraph: unknown;
};

/** 转换 Workflow Version 列表 DTO 所需的数据库投影。 */
type WorkflowVersionListRecord = {
  /** 不可变版本 ID。 */
  id: string;
  /** 所属 Workflow ID。 */
  workflowId: string;
  /** Workflow 内版本号。 */
  version: number;
  /** Graph Schema 版本。 */
  graphSchemaVersion: number;
  /** 编译计划内容摘要。 */
  checksum: string;
  /** 发布管理员 ID。 */
  publishedByUserId: string;
  /** 版本创建时间。 */
  createdAt: Date;
};

/** 转换 Workflow Version 详情 DTO 所需的数据库投影。 */
type WorkflowVersionDetailRecord = WorkflowVersionListRecord & {
  /** 原始 Graph JSON。 */
  graph: unknown;
  /** 编译计划 JSON。 */
  compiledPlan: unknown;
};

const EMPTY_WORKFLOW_GRAPH: WorkflowGraph = {
  schemaVersion: 1,
  nodes: [],
  edges: []
};
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_DRAFT_NODES = 200;
const MAX_DRAFT_EDGES = 500;

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowCompiler: WorkflowCompiler
  ) {}

  /** 管理列表只读取未删除 Workflow，并在数据库层处理状态筛选和分页。 */
  async listWorkflows(query: WorkflowQueryDto): Promise<PageResult<WorkflowListItem>> {
    const page = normalizePageQuery(query);
    const status = this.parseOptionalStatus(query.status);
    const where: Prisma.WorkflowWhereInput = {
      deletedAt: null,
      ...(status ? { status } : {})
    };
    const [rows, total] = await Promise.all([
      this.prisma.workflow.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: page.skip,
        take: page.take,
        include: { _count: { select: { versions: true } } }
      }),
      this.prisma.workflow.count({ where })
    ]);

    return createPageResult(
      rows.map((row) => this.toListItem(row, row._count.versions)),
      total,
      page.page,
      page.pageSize
    );
  }

  /** 创建时只做草稿容器校验；完整 DAG 和资源校验由 W2 编译器负责。 */
  async createWorkflow(payload: WorkflowCreateDto, actorUserId: string): Promise<WorkflowDetail> {
    const graph = this.normalizeGraph(payload.graph ?? EMPTY_WORKFLOW_GRAPH);
    const workflow = await this.prisma.workflow.create({
      data: {
        name: this.requireName(payload.name),
        description: this.normalizeDescription(payload.description),
        draftGraph: graph as Prisma.InputJsonValue,
        createdByUserId: this.requireId(actorUserId, "actorUserId")
      },
      include: { _count: { select: { versions: true } } }
    });
    return this.toDetail(workflow, workflow._count.versions);
  }

  /** 读取未归档 Workflow 的完整草稿详情。 */
  async getWorkflow(id: string): Promise<WorkflowDetail> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: this.requireId(id, "workflowId"), deletedAt: null },
      include: { _count: { select: { versions: true } } }
    });
    if (!workflow) throw this.notFound();
    return this.toDetail(workflow, workflow._count.versions);
  }

  /** 元数据更新不增加 draftRevision，避免画布保存与名称修改产生伪冲突。 */
  async updateWorkflow(id: string, payload: WorkflowUpdateDto): Promise<WorkflowDetail> {
    const workflowId = this.requireId(id, "workflowId");
    await this.ensureExists(workflowId);
    const workflow = await this.prisma.workflow.update({
      where: { id: workflowId },
      data: {
        ...(payload.name !== undefined ? { name: this.requireName(payload.name) } : {}),
        ...(payload.description !== undefined
          ? { description: this.normalizeDescription(payload.description) }
          : {})
      },
      include: { _count: { select: { versions: true } } }
    });
    return this.toDetail(workflow, workflow._count.versions);
  }

  /** expectedRevision 使用条件更新实现乐观锁，防止两个编辑器静默覆盖彼此草稿。 */
  async updateDraft(
    id: string,
    payload: WorkflowDraftUpdateDto
  ): Promise<WorkflowDraftUpdateResult> {
    const workflowId = this.requireId(id, "workflowId");
    const expectedRevision = this.requirePositiveInteger(
      payload.expectedRevision,
      "expectedRevision"
    );
    const graph = this.normalizeGraph(payload.graph);
    const updated = await this.prisma.workflow.updateMany({
      where: {
        id: workflowId,
        deletedAt: null,
        draftRevision: expectedRevision
      },
      data: {
        draftGraph: graph as Prisma.InputJsonValue,
        draftRevision: { increment: 1 }
      }
    });

    if (updated.count !== 1) {
      await this.ensureExists(workflowId);
      throw new AppError(
        ErrorCodes.workflow.revisionConflict,
        "Workflow 草稿已被其他操作更新，请刷新后重试",
        HttpStatus.CONFLICT
      );
    }

    const workflow = await this.prisma.workflow.findUniqueOrThrow({
      where: { id: workflowId },
      select: { draftRevision: true, updatedAt: true }
    });
    return {
      workflowId,
      draftRevision: workflow.draftRevision,
      updatedAt: workflow.updatedAt
    };
  }

  /** 前端可传临时画布做预检；未传时校验数据库中的最新草稿。 */
  async validateWorkflow(
    id: string,
    payload: WorkflowValidateDto = {}
  ): Promise<WorkflowValidationResult> {
    const workflowId = this.requireId(id, "workflowId");
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: workflowId, deletedAt: null },
      select: { draftGraph: true }
    });
    if (!workflow) throw this.notFound();
    const graph =
      payload.graph === undefined ? workflow.draftGraph : this.normalizeGraph(payload.graph);
    return this.workflowCompiler.compile(graph);
  }

  /**
   * 外部资源校验可能发生远程或多模块读取，因此先在事务外编译；写事务再用 revision
   * 做条件更新，保证被发布的 graph 与 compiledPlan 一定来自同一份草稿。
   */
  async publishWorkflow(
    id: string,
    payload: WorkflowPublishDto = {},
    actorUserId: string
  ): Promise<WorkflowPublishResult> {
    const workflowId = this.requireId(id, "workflowId");
    const expectedRevision = this.requirePositiveInteger(
      payload.expectedRevision,
      "expectedRevision"
    );
    const publisherId = this.requireId(actorUserId, "actorUserId");
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: workflowId, deletedAt: null },
      select: {
        draftGraph: true,
        draftRevision: true,
        publishedVersion: true
      }
    });
    if (!workflow) throw this.notFound();
    if (workflow.draftRevision !== expectedRevision) throw this.revisionConflict();

    const graph = this.normalizeGraph(workflow.draftGraph);
    const compilation = await this.workflowCompiler.compile(graph);
    if (!compilation.valid || !compilation.compiledPlan || !compilation.checksum) {
      const summary = compilation.issues.map((issue) => issue.message).join("；");
      throw new AppError(ErrorCodes.workflow.validationFailed, summary || "Workflow 编译校验失败");
    }
    if (!payload.expectedChecksum || payload.expectedChecksum !== compilation.checksum) {
      throw new AppError(
        ErrorCodes.workflow.validationFailed,
        "Workflow 草稿内容已变化，请重新校验后发布",
        HttpStatus.CONFLICT
      );
    }
    const nextVersion = (workflow.publishedVersion ?? 0) + 1;
    const compiledPlan = compilation.compiledPlan;
    const checksum = compilation.checksum;

    return this.prisma.$transaction(
      async (transaction) => {
        const updated = await transaction.workflow.updateMany({
          where: {
            id: workflowId,
            deletedAt: null,
            draftRevision: expectedRevision,
            // 同一 draftRevision 可能被两个发布请求同时读取，旧 publishedVersion 也是写入前置条件。
            publishedVersion: workflow.publishedVersion
          },
          data: {
            status: WorkflowStatus.PUBLISHED,
            publishedVersion: nextVersion
          }
        });
        if (updated.count !== 1) throw this.revisionConflict();

        const version = await transaction.workflowVersion.create({
          data: {
            workflowId,
            version: nextVersion,
            graphSchemaVersion: graph.schemaVersion,
            graph: graph as Prisma.InputJsonValue,
            compiledPlan: compiledPlan as unknown as Prisma.InputJsonValue,
            checksum,
            publishedByUserId: publisherId
          },
          select: { id: true, createdAt: true }
        });
        return {
          workflowId,
          workflowVersionId: version.id,
          version: nextVersion,
          checksum,
          publishedAt: version.createdAt
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  /** 软删除保留历史 Version 和 Run 的可解释性，并阻止其继续作为已发布配置使用。 */
  async archiveWorkflow(id: string): Promise<void> {
    const workflowId = this.requireId(id, "workflowId");
    await this.ensureExists(workflowId);
    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: {
        status: WorkflowStatus.ARCHIVED,
        deletedAt: new Date()
      }
    });
  }

  /** 返回指定 Workflow 的全部不可变版本，按版本号倒序排列。 */
  async listVersions(workflowId: string): Promise<WorkflowVersionListItem[]> {
    const normalizedWorkflowId = this.requireId(workflowId, "workflowId");
    await this.ensureExists(normalizedWorkflowId);
    const versions = await this.prisma.workflowVersion.findMany({
      where: { workflowId: normalizedWorkflowId },
      orderBy: { version: "desc" }
    });
    return versions.map((version) => this.toVersionListItem(version));
  }

  /** 读取属于指定 Workflow 的单个不可变版本。 */
  async getVersion(workflowId: string, versionId: string): Promise<WorkflowVersionDetail> {
    const version = await this.prisma.workflowVersion.findFirst({
      where: {
        id: this.requireId(versionId, "workflowVersionId"),
        workflowId: this.requireId(workflowId, "workflowId")
      }
    });
    if (!version) {
      throw new AppError(
        ErrorCodes.workflow.versionNotFound,
        "Workflow Version 不存在",
        HttpStatus.NOT_FOUND
      );
    }
    return this.toVersionDetail(version);
  }

  /**
   * Runtime 可读取仍处于发布状态 Workflow 的任一不可变版本。
   * 独立入口会传当前版本，而 Agent Tool 会传绑定时的历史版本，从而避免重新发布后静默漂移。
   */
  async getPublishedRuntimeConfig(
    workflowId: string,
    versionId: string
  ): Promise<PublishedWorkflowRuntimeConfig> {
    const version = await this.prisma.workflowVersion.findFirst({
      where: {
        id: this.requireId(versionId, "workflowVersionId"),
        workflowId: this.requireId(workflowId, "workflowId"),
        workflow: {
          deletedAt: null,
          status: WorkflowStatus.PUBLISHED
        }
      },
      include: { workflow: { select: { publishedVersion: true } } }
    });
    if (!version) {
      throw new AppError(
        ErrorCodes.workflow.notPublished,
        "Workflow Version 未发布或已失效",
        HttpStatus.CONFLICT
      );
    }
    return {
      workflowId: version.workflowId,
      workflowVersionId: version.id,
      version: version.version,
      graphSchemaVersion: version.graphSchemaVersion,
      checksum: version.checksum,
      compiledPlan: this.toObject(version.compiledPlan, "compiledPlan")
    };
  }

  /** 返回所有当前可运行的 Workflow 应用，普通成员无需读取草稿 Graph。 */
  async listPublishedApps(): Promise<PublishedWorkflowApp[]> {
    const workflows = await this.prisma.workflow.findMany({
      where: { deletedAt: null, status: WorkflowStatus.PUBLISHED, publishedVersion: { not: null } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: { versions: { orderBy: { version: "desc" }, take: 1 } }
    });
    return workflows.flatMap((workflow) => {
      const version = workflow.versions[0];
      if (!version || version.version !== workflow.publishedVersion) return [];
      return [
        this.toPublishedApp(
          workflow.id,
          workflow.name,
          workflow.description,
          version.id,
          version.version,
          version.graph,
          version.createdAt
        )
      ];
    });
  }

  /** 读取单个当前发布应用；历史版本不能从独立入口直接运行。 */
  async getPublishedApp(workflowId: string): Promise<PublishedWorkflowApp> {
    const id = this.requireId(workflowId, "workflowId");
    const workflow = await this.prisma.workflow.findFirst({
      where: { id, deletedAt: null, status: WorkflowStatus.PUBLISHED },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } }
    });
    const version = workflow?.versions[0];
    if (!workflow || !version || version.version !== workflow.publishedVersion) {
      throw new AppError(
        ErrorCodes.workflow.notPublished,
        "Workflow 尚未发布",
        HttpStatus.CONFLICT
      );
    }
    return this.toPublishedApp(
      workflow.id,
      workflow.name,
      workflow.description,
      version.id,
      version.version,
      version.graph,
      version.createdAt
    );
  }

  /** Workflow Tool 固定绑定发布版本，避免后续发布静默改变 Agent 行为。 */
  async getWorkflowToolDefinitions(toolIds?: string[]): Promise<ToolDefinition[]> {
    const requested = toolIds ? new Set(toolIds) : null;
    const apps = requested
      ? await this.getPublishedAppsByToolIds([...requested])
      : await this.listPublishedApps();
    return apps.flatMap((app) => {
      const id = this.formatWorkflowToolId(app.workflowId, app.workflowVersionId);
      if (requested && !requested.has(id)) return [];
      return [
        {
          id,
          name: `workflow_${app.workflowId.replaceAll("-", "_")}`,
          description: `${app.description || app.name}（Workflow v${app.version}）`,
          enabled: true,
          inputSchema: {
            type: "object",
            properties: Object.fromEntries(
              app.inputs.map((input) => [
                input.name,
                {
                  type: input.type,
                  description: input.description || input.name,
                  ...(input.defaultValue === undefined ? {} : { default: input.defaultValue })
                }
              ])
            ),
            required: app.inputs.filter((input) => input.required).map((input) => input.name),
            additionalProperties: false
          }
        }
      ];
    });
  }

  /** 按 Agent 保存的版本化 Tool ID 恢复定义，历史发布版本同样保持可执行。 */
  private async getPublishedAppsByToolIds(toolIds: string[]): Promise<PublishedWorkflowApp[]> {
    const bindings = toolIds.flatMap((toolId) => {
      const parsed = this.parseWorkflowToolId(toolId);
      return parsed ? [parsed] : [];
    });
    if (bindings.length === 0) return [];

    const versions = await this.prisma.workflowVersion.findMany({
      where: {
        OR: bindings.map((binding) => ({
          id: binding.workflowVersionId,
          workflowId: binding.workflowId
        })),
        workflow: { deletedAt: null, status: WorkflowStatus.PUBLISHED }
      },
      include: {
        workflow: { select: { id: true, name: true, description: true } }
      }
    });
    return versions.map((version) =>
      this.toPublishedApp(
        version.workflow.id,
        version.workflow.name,
        version.workflow.description,
        version.id,
        version.version,
        version.graph,
        version.createdAt
      )
    );
  }

  /** 解析版本化 Workflow Tool ID；普通工具返回 null。 */
  parseWorkflowToolId(toolId: string): { workflowId: string; workflowVersionId: string } | null {
    const match = /^workflow:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(toolId.trim());
    return match ? { workflowId: match[1], workflowVersionId: match[2] } : null;
  }

  /** 生成 AgentTool 可持久化的版本化 ID。 */
  formatWorkflowToolId(workflowId: string, workflowVersionId: string): string {
    return `workflow:${workflowId}:${workflowVersionId}`;
  }

  /** 从版本 Graph 提取 Start 输入；发布版本是表单与 Tool Schema 的唯一来源。 */
  private toPublishedApp(
    workflowId: string,
    name: string,
    description: string,
    workflowVersionId: string,
    version: number,
    graphValue: unknown,
    publishedAt: Date
  ): PublishedWorkflowApp {
    const graph = this.normalizeGraph(graphValue);
    const start = graph.nodes.find((node) => node.type === "start");
    const rawInputs = Array.isArray(start?.config.inputs) ? start.config.inputs : [];
    const inputs: PublishedWorkflowInput[] = rawInputs.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const input = value as Record<string, unknown>;
      const inputType = String(input.type);
      if (
        typeof input.name !== "string" ||
        !["string", "number", "boolean", "object", "array"].includes(inputType)
      ) {
        return [];
      }
      return [
        {
          name: input.name,
          type: inputType as PublishedWorkflowInput["type"],
          required: input.required === true,
          description: typeof input.description === "string" ? input.description : "",
          ...(input.defaultValue === undefined ? {} : { defaultValue: input.defaultValue })
        }
      ];
    });
    return { workflowId, name, description, workflowVersionId, version, inputs, publishedAt };
  }

  /** 确认 Workflow 存在且未软删除。 */
  private async ensureExists(id: string): Promise<void> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id, deletedAt: null },
      select: { id: true }
    });
    if (!workflow) throw this.notFound();
  }

  /** 将数据库或请求中的未知 JSON 归一为 Workflow V1 Graph。 */
  private normalizeGraph(value: unknown): WorkflowGraph {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AppError(ErrorCodes.workflow.invalidGraph, "graph 必须是对象");
    }
    const graph = value as Record<string, unknown>;
    if (graph.schemaVersion !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      throw new AppError(
        ErrorCodes.workflow.invalidGraph,
        "graph 必须包含 schemaVersion=1、nodes 和 edges"
      );
    }
    if (graph.nodes.length > MAX_DRAFT_NODES || graph.edges.length > MAX_DRAFT_EDGES) {
      throw new AppError(
        ErrorCodes.workflow.invalidGraph,
        `graph 不能超过 ${MAX_DRAFT_NODES} 个节点和 ${MAX_DRAFT_EDGES} 条边`
      );
    }
    return {
      schemaVersion: 1,
      nodes: graph.nodes,
      edges: graph.edges
    };
  }

  /** 校验并规范化 Workflow 名称。 */
  private requireName(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new AppError(ErrorCodes.common.badRequest, "name is required");
    }
    const name = value.trim();
    if (name.length > MAX_NAME_LENGTH) {
      throw new AppError(ErrorCodes.common.badRequest, `name 不能超过 ${MAX_NAME_LENGTH} 个字符`);
    }
    return name;
  }

  /** 规范化可选描述并限制长度。 */
  private normalizeDescription(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") {
      throw new AppError(ErrorCodes.common.badRequest, "description 必须是字符串");
    }
    const description = value.trim();
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `description 不能超过 ${MAX_DESCRIPTION_LENGTH} 个字符`
      );
    }
    return description;
  }

  /** 校验必填字符串 ID。 */
  private requireId(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new AppError(ErrorCodes.common.badRequest, `${field} is required`);
    }
    return value.trim();
  }

  /** 校验发布和草稿乐观锁使用的正整数。 */
  private requirePositiveInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 1) {
      throw new AppError(ErrorCodes.common.badRequest, `${field} 必须是正整数`);
    }
    return Number(value);
  }

  /** 严格解析可选 Workflow 状态筛选。 */
  private parseOptionalStatus(value: unknown): WorkflowStatus | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (Object.values(WorkflowStatus).includes(value as WorkflowStatus)) {
      return value as WorkflowStatus;
    }
    throw new AppError(ErrorCodes.common.badRequest, "status 无效");
  }

  /** 隔离数据库投影并补充版本数量。 */
  private toListItem(workflow: WorkflowListRecord, versionCount: number): WorkflowListItem {
    return { ...workflow, versionCount };
  }

  /** 将数据库 Graph JSON 转换为稳定详情 DTO。 */
  private toDetail(workflow: WorkflowDetailRecord, versionCount: number): WorkflowDetail {
    return {
      ...this.toListItem(workflow, versionCount),
      draftGraph: this.normalizeGraph(workflow.draftGraph)
    };
  }

  /** 将版本数据库投影转换为列表 DTO。 */
  private toVersionListItem(version: WorkflowVersionListRecord): WorkflowVersionListItem {
    return version;
  }

  /** 将版本 Graph 和编译计划 JSON 转换为详情 DTO。 */
  private toVersionDetail(version: WorkflowVersionDetailRecord): WorkflowVersionDetail {
    return {
      ...this.toVersionListItem(version),
      graph: this.normalizeGraph(version.graph),
      compiledPlan: this.toObject(version.compiledPlan, "compiledPlan")
    };
  }

  /** 确认数据库 JSON 是普通对象。 */
  private toObject(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AppError(ErrorCodes.workflow.invalidGraph, `${field} 必须是对象`);
    }
    return value as Record<string, unknown>;
  }

  /** 构造统一的 Workflow 不存在错误。 */
  private notFound(): AppError {
    return new AppError(ErrorCodes.workflow.notFound, "Workflow 不存在", HttpStatus.NOT_FOUND);
  }

  /** 构造草稿修订冲突错误。 */
  private revisionConflict(): AppError {
    return new AppError(
      ErrorCodes.workflow.revisionConflict,
      "Workflow 草稿已被其他操作更新，请刷新后重试",
      HttpStatus.CONFLICT
    );
  }
}
