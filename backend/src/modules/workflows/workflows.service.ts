import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, WorkflowStatus } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { createPageResult, normalizePageQuery } from "../../core/pagination";
import { PageResult } from "../../core/result";
import { PrismaService } from "../prisma/prisma.service";
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

  async listVersions(workflowId: string): Promise<WorkflowVersionListItem[]> {
    const normalizedWorkflowId = this.requireId(workflowId, "workflowId");
    await this.ensureExists(normalizedWorkflowId);
    const versions = await this.prisma.workflowVersion.findMany({
      where: { workflowId: normalizedWorkflowId },
      orderBy: { version: "desc" }
    });
    return versions.map((version) => this.toVersionListItem(version));
  }

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

  /** Agent 绑定和未来 Runtime 只能读取当前已发布且未归档的不可变版本。 */
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
    if (!version || version.workflow.publishedVersion !== version.version) {
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

  private async ensureExists(id: string): Promise<void> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id, deletedAt: null },
      select: { id: true }
    });
    if (!workflow) throw this.notFound();
  }

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

  private requireId(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new AppError(ErrorCodes.common.badRequest, `${field} is required`);
    }
    return value.trim();
  }

  private requirePositiveInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 1) {
      throw new AppError(ErrorCodes.common.badRequest, `${field} 必须是正整数`);
    }
    return Number(value);
  }

  private parseOptionalStatus(value: unknown): WorkflowStatus | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (Object.values(WorkflowStatus).includes(value as WorkflowStatus)) {
      return value as WorkflowStatus;
    }
    throw new AppError(ErrorCodes.common.badRequest, "status 无效");
  }

  private toListItem(
    workflow: {
      id: string;
      name: string;
      description: string;
      status: WorkflowStatus;
      draftRevision: number;
      publishedVersion: number | null;
      createdByUserId: string;
      createdAt: Date;
      updatedAt: Date;
    },
    versionCount: number
  ): WorkflowListItem {
    return { ...workflow, versionCount };
  }

  private toDetail(
    workflow: Parameters<WorkflowsService["toListItem"]>[0] & { draftGraph: unknown },
    versionCount: number
  ): WorkflowDetail {
    return {
      ...this.toListItem(workflow, versionCount),
      draftGraph: this.normalizeGraph(workflow.draftGraph)
    };
  }

  private toVersionListItem(version: {
    id: string;
    workflowId: string;
    version: number;
    graphSchemaVersion: number;
    checksum: string;
    publishedByUserId: string;
    createdAt: Date;
  }): WorkflowVersionListItem {
    return version;
  }

  private toVersionDetail(
    version: Parameters<WorkflowsService["toVersionListItem"]>[0] & {
      graph: unknown;
      compiledPlan: unknown;
    }
  ): WorkflowVersionDetail {
    return {
      ...this.toVersionListItem(version),
      graph: this.normalizeGraph(version.graph),
      compiledPlan: this.toObject(version.compiledPlan, "compiledPlan")
    };
  }

  private toObject(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AppError(ErrorCodes.workflow.invalidGraph, `${field} 必须是对象`);
    }
    return value as Record<string, unknown>;
  }

  private notFound(): AppError {
    return new AppError(ErrorCodes.workflow.notFound, "Workflow 不存在", HttpStatus.NOT_FOUND);
  }

  private revisionConflict(): AppError {
    return new AppError(
      ErrorCodes.workflow.revisionConflict,
      "Workflow 草稿已被其他操作更新，请刷新后重试",
      HttpStatus.CONFLICT
    );
  }
}
