import { HttpStatus, Injectable, Optional } from "@nestjs/common";
import {
  AgentChatSessionMode,
  AgentExecutionMode,
  AgentVisionMode,
  ModelConfigType,
  ModelThinkingMode,
  Prisma,
  WorkspaceRole
} from "@prisma/client";
import { randomBytes } from "node:crypto";

import { AppError, ErrorCodes } from "../../core/errors";
import {
  getWorkspaceId,
  requireWorkspaceActor,
  requireWorkspaceId
} from "../../core/auth/workspace-context";
import { createPageResult, normalizePageQuery } from "../../core/pagination";
import { PageResult } from "../../core/result";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { ModelProvidersService } from "../model-providers/model-providers.service";
import { PrismaService } from "../prisma/prisma.service";
import { SkillsService } from "../skills/skills.service";
import { ToolsService } from "../tools/tools.service";
import { CurrentUserDto } from "../users/dto/user.dto";
import { CurrentWorkspaceDto } from "../workspaces/dto/workspace.dto";
import { WorkflowsService } from "../workflows/workflows.service";
import {
  AgentCreateDto,
  AgentDetail,
  AgentGenerationParams,
  AgentKnowledgeBaseBindingDto,
  AgentKnowledgeBaseBindingResult,
  AgentListItem,
  AgentModelConfigSummary,
  AgentPublicAccessConfig,
  AgentPublicAccessRuntime,
  AgentPublishResult,
  AgentQueryDto,
  AgentRuntimeConfig,
  AgentSkillBindingDto,
  AgentSkillBindingResult,
  AgentToolBindingDto,
  AgentToolBindingResult,
  AgentUpdateDto,
  AgentWorkflowBindingDto,
  AgentWorkflowBindingResult,
  SharedAgentDetail
} from "./dto/agent.dto";

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_TIMEOUT_SECONDS = 120;
const DEFAULT_HISTORY_TURNS = 6;
const MAX_AGENT_SKILLS = 10;

/**
 * Agent 查询的完整 Prisma 投影。
 * 仅在 agents 模块内部使用，跨模块返回时必须转换为明确 DTO。
 */
type AgentWithModelConfig = Prisma.AgentGetPayload<{
  /** 一次加载列表、详情和运行时转换共同需要的关联。 */
  include: {
    /** Agent 绑定的模型配置。 */
    modelConfig: {
      /** 同时加载供应商以生成安全摘要与运行时路由信息。 */
      include: {
        /** 模型供应商记录。 */
        provider: true;
      };
    };
    /** Agent 工具绑定记录。 */
    agentTools: true;
    /** Agent Skill 有序绑定记录。 */
    agentSkills: true;
    /** 资源创建者用于成员级修改授权和列表展示。 */
    createdBy: {
      select: {
        id: true;
        displayName: true;
      };
    };
    /** Agent 工作流绑定记录。 */
    agentWorkflow: true;
    /** Agent 知识库绑定及可用性判断所需字段。 */
    agentKnowledgeBases: {
      /** 加载知识库的启用与软删除状态。 */
      include: {
        /** 绑定指向的知识库。 */
        knowledgeBase: {
          /** 仅选择判断绑定是否可运行所需字段。 */
          select: {
            /** 知识库是否启用。 */
            enabled: true;
            /** 知识库软删除时间。 */
            deletedAt: true;
          };
        };
      };
    };
    /** 列表展示绑定数量所需的聚合计数。 */
    _count: {
      /** 仅统计列表实际展示的两类绑定。 */
      select: {
        /** 工具绑定数量。 */
        agentTools: true;
        agentSkills: true;
        /** 知识库绑定数量。 */
        agentKnowledgeBases: true;
      };
    };
  };
}>;

/** 写入 Agent 表前已经完成默认值、格式和跨模块引用校验的数据。 */
type AgentCreateData = {
  /** 规范化后的 Agent 名称。 */
  name: string;
  /** 规范化后的用途说明。 */
  description: string;
  /** 系统提示词。 */
  systemPrompt: string;
  /** 模型配置 ID；创建校验前允许暂存 null。 */
  modelConfigId: string | null;
  visionMode: AgentVisionMode;
  visionModelConfigId: string | null;
  /** 模型采样温度。 */
  temperature: number;
  /** 生成 token 上限。 */
  maxTokens: number | null;
  /** 调用超时秒数。 */
  timeoutSeconds: number;
  /** 历史上下文轮数。 */
  historyTurns: number;
  /** 会话保存模式。 */
  chatSessionMode: AgentChatSessionMode;
  /** 模型扩展生成参数。 */
  generationParams: AgentGenerationParams | null;
  thinkingMode: ModelThinkingMode;
  /** Agent 启用状态。 */
  enabled: boolean;
};

/** 更新时允许部分提供的持久化数据；模型 ID 一旦提供必须是有效字符串。 */
type AgentUpdateData = Partial<Omit<AgentCreateData, "modelConfigId">> & {
  /** 新模型配置 ID。 */
  modelConfigId?: string;
};

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelProvidersService: ModelProvidersService,
    private readonly toolsService: ToolsService,
    private readonly knowledgeService: KnowledgeService,
    private readonly workflowsService: WorkflowsService,
    @Optional() private readonly skillsService?: SkillsService
  ) {}

  /**
   * 按当前访问者权限列出 Agent。
   *
   * 普通成员只需要使用已启用 Agent，因此查询条件在服务层强制收敛为 enabled=true；
   * 不能只依赖前端隐藏按钮，否则直接调用 API 仍会暴露停用配置。
   */
  async listAgents(
    query: AgentQueryDto,
    currentUser?: Pick<CurrentUserDto, "id" | "role">,
    currentWorkspace?: Pick<CurrentWorkspaceDto, "role">
  ): Promise<PageResult<AgentListItem>> {
    const page = normalizePageQuery(query);
    const actor = requireWorkspaceActor();
    const where: Prisma.AgentWhereInput = {
      workspaceId: requireWorkspaceId(),
      deletedAt: null,
      ...(currentWorkspace?.role === "MEMBER"
        ? {
            OR: [{ enabled: true }, { createdByUserId: currentUser?.id ?? actor.userId }]
          }
        : query.enabled !== undefined
          ? { enabled: this.parseEnabled(query.enabled) }
          : {})
    };

    const [list, total] = await this.prisma.$transaction([
      this.prisma.agent.findMany({
        where,
        include: {
          modelConfig: {
            include: {
              provider: true
            }
          },
          createdBy: { select: { id: true, displayName: true } },
          agentTools: true,
          agentSkills: true,
          agentWorkflow: true,
          agentKnowledgeBases: this.getAgentKnowledgeBaseInclude(),
          _count: {
            select: {
              agentTools: true,
              agentSkills: true,
              agentKnowledgeBases: true
            }
          }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page.skip,
        take: page.take
      }),
      this.prisma.agent.count({ where })
    ]);

    return createPageResult(
      list.map((agent) => this.toAgentListItem(agent)),
      total,
      page.page,
      page.pageSize
    );
  }

  /** 创建 Agent，并在同一事务中写入基础配置。 */
  async createAgent(payload: AgentCreateDto): Promise<AgentDetail> {
    const actor = requireWorkspaceActor();
    const data = this.validateAgentCreate(payload);
    const modelConfigId = await this.resolveCreateModelConfigId(data.modelConfigId);
    await this.ensureChatModelConfig(modelConfigId);
    await this.ensureVisionPolicy(data.visionMode, data.visionModelConfigId);

    const agent = await this.prisma.agent.create({
      data: {
        workspaceId: requireWorkspaceId(),
        createdByUserId: actor.userId,
        name: data.name,
        description: data.description,
        systemPrompt: data.systemPrompt,
        modelConfigId,
        visionMode: data.visionMode,
        visionModelConfigId: data.visionModelConfigId,
        temperature: data.temperature,
        maxTokens: data.maxTokens,
        timeoutSeconds: data.timeoutSeconds,
        historyTurns: data.historyTurns,
        chatSessionMode: data.chatSessionMode,
        generationParams: this.toPrismaJson(data.generationParams),
        thinkingMode: data.thinkingMode,
        enabled: data.enabled
      },
      include: {
        modelConfig: {
          include: {
            provider: true
          }
        },
        createdBy: { select: { id: true, displayName: true } },
        agentTools: true,
        agentSkills: true,
        agentWorkflow: true,
        agentKnowledgeBases: this.getAgentKnowledgeBaseInclude(),
        _count: {
          select: {
            agentTools: true,
            agentSkills: true,
            agentKnowledgeBases: true
          }
        }
      }
    });

    return this.toAgentDetail(agent);
  }

  /** 读取 Agent 完整详情，已软删除记录视为不存在。 */
  async getAgent(id: string): Promise<AgentDetail> {
    const agent = await this.findAgentDetail(id);
    this.assertCanManageAgent(agent.createdByUserId);
    return this.toAgentDetail(agent);
  }

  /** 更新 Agent 基础配置；模型引用在写入前由模型模块校验。 */
  async updateAgent(id: string, payload: AgentUpdateDto): Promise<AgentDetail> {
    await this.ensureCanManageAgent(id);
    const data = this.validateAgentUpdate(payload);

    if (data.modelConfigId) {
      await this.ensureChatModelConfig(data.modelConfigId);
    }
    const existing = await this.findAgentDetail(id);
    await this.ensureVisionPolicy(
      data.visionMode ?? existing.visionMode,
      data.visionModelConfigId !== undefined
        ? data.visionModelConfigId
        : existing.visionModelConfigId
    );

    const agent = await this.prisma.agent.update({
      where: { id, workspaceId: requireWorkspaceId() },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.systemPrompt !== undefined ? { systemPrompt: data.systemPrompt } : {}),
        ...(data.modelConfigId !== undefined
          ? {
              modelConfig: {
                connect: { id: data.modelConfigId }
              }
            }
          : {}),
        ...(data.visionMode !== undefined ? { visionMode: data.visionMode } : {}),
        ...(data.visionModelConfigId !== undefined
          ? {
              visionModelConfig: data.visionModelConfigId
                ? { connect: { id: data.visionModelConfigId } }
                : { disconnect: true }
            }
          : {}),
        ...(data.temperature !== undefined ? { temperature: data.temperature } : {}),
        ...(data.maxTokens !== undefined ? { maxTokens: data.maxTokens } : {}),
        ...(data.timeoutSeconds !== undefined ? { timeoutSeconds: data.timeoutSeconds } : {}),
        ...(data.historyTurns !== undefined ? { historyTurns: data.historyTurns } : {}),
        ...(data.chatSessionMode !== undefined ? { chatSessionMode: data.chatSessionMode } : {}),
        ...(data.generationParams !== undefined
          ? { generationParams: this.toPrismaJson(data.generationParams) }
          : {}),
        ...(data.thinkingMode !== undefined ? { thinkingMode: data.thinkingMode } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {})
      },
      include: {
        modelConfig: {
          include: {
            provider: true
          }
        },
        createdBy: { select: { id: true, displayName: true } },
        agentTools: true,
        agentSkills: true,
        agentWorkflow: true,
        agentKnowledgeBases: this.getAgentKnowledgeBaseInclude(),
        _count: {
          select: {
            agentTools: true,
            agentSkills: true,
            agentKnowledgeBases: true
          }
        }
      }
    });

    return this.toAgentDetail(agent);
  }

  /** 软删除 Agent，保留审计与历史运行关联。 */
  async deleteAgent(id: string): Promise<void> {
    await this.ensureCanManageAgent(id);

    await this.prisma.agent.update({
      where: { id, workspaceId: requireWorkspaceId() },
      data: {
        deletedAt: new Date(),
        enabled: false
      }
    });
  }

  /** 发布 Agent 并生成不可预测的公开分享令牌。 */
  async publishAgent(id: string): Promise<AgentPublishResult> {
    await this.ensureCanManageAgent(id);
    const existing = await this.prisma.agent.findUnique({
      where: { id, workspaceId: requireWorkspaceId() },
      select: {
        shareToken: true,
        executionMode: true,
        agentWorkflow: true
      }
    });
    if (existing?.executionMode === AgentExecutionMode.WORKFLOW) {
      if (!existing.agentWorkflow) {
        throw new AppError(
          ErrorCodes.agent.invalidWorkflow,
          "WORKFLOW 模式的 Agent 必须绑定已发布 Workflow Version"
        );
      }
      // 发布前重新校验，防止 Agent 绑定后 Workflow 被归档或发布版本发生变化。
      await this.workflowsService.getPublishedRuntimeConfig(
        existing.agentWorkflow.workflowId,
        existing.agentWorkflow.workflowVersionId
      );
    }
    const shareToken = existing?.shareToken || this.createShareToken();

    const agent = await this.prisma.agent.update({
      where: { id, workspaceId: requireWorkspaceId() },
      data: {
        published: true,
        publishedAt: new Date(),
        shareToken
      },
      select: {
        id: true,
        published: true,
        publishedAt: true,
        shareToken: true
      }
    });

    return {
      agentId: agent.id,
      published: agent.published,
      publishedAt: agent.publishedAt,
      shareToken: agent.shareToken
    };
  }

  /** 取消发布并使现有公开链接立即失效。 */
  async unpublishAgent(id: string): Promise<AgentPublishResult> {
    await this.ensureCanManageAgent(id);

    const agent = await this.prisma.agent.update({
      where: { id, workspaceId: requireWorkspaceId() },
      data: {
        published: false,
        publishedAt: null
      },
      select: {
        id: true,
        published: true,
        publishedAt: true,
        shareToken: true
      }
    });

    return {
      agentId: agent.id,
      published: agent.published,
      publishedAt: agent.publishedAt,
      shareToken: agent.shareToken
    };
  }

  /**
   * 轮换公开 Token 会立即让旧嵌入代码失效。
   *
   * 该操作不改变发布状态或 API Key；管理员需要把返回的新 Token 更新到外部页面，
   * 用于 Token 泄露或不再信任旧嵌入代码时的快速止损。
   */
  async rotateShareToken(id: string): Promise<AgentPublishResult> {
    await this.ensureCanManageAgent(id);
    const agent = await this.prisma.agent.update({
      where: { id, workspaceId: requireWorkspaceId() },
      data: { shareToken: this.createShareToken() },
      select: {
        id: true,
        published: true,
        publishedAt: true,
        shareToken: true
      }
    });

    return {
      agentId: agent.id,
      published: agent.published,
      publishedAt: agent.publishedAt,
      shareToken: agent.shareToken
    };
  }

  /** 读取公开发布治理配置；密码字段只转换为是否启用，永不返回哈希。 */
  async getPublicAccessConfig(id: string): Promise<AgentPublicAccessConfig> {
    await this.ensureCanManageAgent(id);
    const agent = await this.prisma.agent.findUniqueOrThrow({
      where: { id, workspaceId: requireWorkspaceId() },
      select: {
        publicExpiresAt: true,
        publicAllowedOrigins: true,
        publicPasswordHash: true
      }
    });

    return {
      agentId: id,
      publicExpiresAt: agent.publicExpiresAt,
      publicAllowedOrigins: agent.publicAllowedOrigins,
      passwordRequired: Boolean(agent.publicPasswordHash)
    };
  }

  /**
   * 保存发布治理配置。
   *
   * 密码哈希只允许 external_access 在验证并哈希后传入；undefined 表示保留原值，null 才是
   * 明确关闭访问密码，防止管理员只改域名时意外清除保护。
   */
  async updatePublicAccessConfig(
    id: string,
    input: {
      publicExpiresAt: Date | null;
      publicAllowedOrigins: string[];
      publicPasswordHash?: string | null;
    }
  ): Promise<AgentPublicAccessConfig> {
    await this.ensureCanManageAgent(id);
    const agent = await this.prisma.agent.update({
      where: { id, workspaceId: requireWorkspaceId() },
      data: {
        publicExpiresAt: input.publicExpiresAt,
        publicAllowedOrigins: input.publicAllowedOrigins,
        ...(input.publicPasswordHash === undefined
          ? {}
          : { publicPasswordHash: input.publicPasswordHash })
      },
      select: {
        publicExpiresAt: true,
        publicAllowedOrigins: true,
        publicPasswordHash: true
      }
    });

    return {
      agentId: id,
      publicExpiresAt: agent.publicExpiresAt,
      publicAllowedOrigins: agent.publicAllowedOrigins,
      passwordRequired: Boolean(agent.publicPasswordHash)
    };
  }

  /** 通过分享令牌读取匿名页面所需的最小公开信息。 */
  async getSharedAgent(token: string): Promise<SharedAgentDetail> {
    const agent = await this.getPublicAccessRuntime(token);

    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      modelName: agent.modelName,
      providerName: agent.providerName,
      passwordRequired: agent.passwordRequired
    };
  }

  /**
   * external_access 使用该运行时配置执行来源域名和密码校验。
   *
   * 过期判断必须在数据库过滤层完成，避免 Profile 与 Chat 两个入口出现“页面能打开、发送失败”
   * 的不一致状态；密码哈希只在模块边界内传递，不会进入公共 DTO。
   */
  async getPublicAccessRuntime(token: string): Promise<AgentPublicAccessRuntime> {
    const shareToken = this.requireNonEmptyString(token, "token");
    const agent = await this.prisma.agent.findFirst({
      where: {
        shareToken,
        published: true,
        enabled: true,
        deletedAt: null,
        OR: [{ publicExpiresAt: null }, { publicExpiresAt: { gt: new Date() } }]
      },
      include: {
        modelConfig: {
          include: {
            provider: true
          }
        }
      }
    });

    if (!agent) {
      throw new AppError(ErrorCodes.agent.notFound, "shared agent not found", HttpStatus.NOT_FOUND);
    }

    return {
      id: agent.id,
      workspaceId: agent.workspaceId,
      name: agent.name,
      description: agent.description,
      modelName: agent.modelConfig.modelName,
      providerName: agent.modelConfig.provider.name,
      passwordRequired: Boolean(agent.publicPasswordHash),
      publicExpiresAt: agent.publicExpiresAt,
      publicAllowedOrigins: agent.publicAllowedOrigins,
      publicPasswordHash: agent.publicPasswordHash
    };
  }

  /** 返回 Chat/Runtime 使用的跨模块 DTO，不泄露 Prisma 实体和供应商密钥。 */
  async getAgentRuntimeConfig(id: string): Promise<AgentRuntimeConfig> {
    const agent = await this.findAgentDetail(id);

    if (!agent.enabled) {
      throw new AppError(ErrorCodes.agent.notFound, "agent not found", HttpStatus.NOT_FOUND);
    }

    const orderedSkillBindings = [...(agent.agentSkills ?? [])].sort(
      (left, right) =>
        left.position - right.position ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.skillId.localeCompare(right.skillId)
    );
    const enabledSkillBindings = orderedSkillBindings.filter((binding) => binding.enabled);
    const runtimeSkills = this.skillsService
      ? await this.skillsService.getRuntimeSkills(
          enabledSkillBindings.map((binding) => binding.skillId)
        )
      : { active: [], unavailableSkillIds: [] };
    const positionBySkillId = new Map(
      enabledSkillBindings.map((binding) => [binding.skillId, binding.position])
    );

    return {
      agentId: agent.id,
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      modelConfigId: agent.modelConfigId,
      vision: {
        mode: agent.visionMode,
        visionModelConfigId: agent.visionModelConfigId
      },
      modelName: agent.modelConfig.modelName,
      providerId: agent.modelConfig.providerId,
      providerType: agent.modelConfig.provider.providerType,
      baseUrl: agent.modelConfig.provider.baseUrl,
      temperature: Number(agent.temperature),
      maxTokens: agent.maxTokens,
      timeoutSeconds: agent.timeoutSeconds,
      historyTurns: agent.historyTurns,
      chatSessionMode: agent.chatSessionMode,
      executionMode: agent.executionMode,
      workflow: agent.agentWorkflow
        ? {
            workflowId: agent.agentWorkflow.workflowId,
            workflowVersionId: agent.agentWorkflow.workflowVersionId
          }
        : null,
      generationParams: this.toGenerationParams(agent.generationParams),
      thinkingMode: this.resolveThinkingMode(
        agent.thinkingMode,
        agent.modelConfig.thinkingSupported,
        agent.modelConfig.thinkingMode
      ),
      knowledgeBaseIds: agent.agentKnowledgeBases
        .filter((knowledgeBase) => this.isActiveAgentKnowledgeBase(knowledgeBase))
        .map((knowledgeBase) => knowledgeBase.knowledgeBaseId),
      toolIds: agent.agentTools.map((tool) => tool.toolId),
      skills: runtimeSkills.active.map((skill) => ({
        ...skill,
        position: positionBySkillId.get(skill.id) ?? 0
      })),
      unavailableSkillBindings: [
        ...orderedSkillBindings
          .filter((binding) => !binding.enabled)
          .map((binding) => ({
            skillId: binding.skillId,
            reason: "DISABLED_OR_ARCHIVED" as const
          })),
        ...runtimeSkills.unavailableSkillIds.map((skillId) => ({
          skillId,
          reason: "DISABLED_OR_ARCHIVED" as const
        }))
      ]
    };
  }

  /** 读取 Agent 已绑定的工具 ID。 */
  async getAgentTools(id: string): Promise<AgentToolBindingResult> {
    await this.ensureCanManageAgent(id);

    const tools = await this.prisma.agentTool.findMany({
      where: {
        agentId: id
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    return {
      agentId: id,
      toolIds: tools.map((tool) => tool.toolId)
    };
  }

  /** 读取 Agent 当前执行策略；绑定表由 agents 模块独占写入。 */
  async getAgentWorkflow(id: string): Promise<AgentWorkflowBindingResult> {
    await this.ensureCanManageAgent(id);
    const agent = await this.prisma.agent.findUniqueOrThrow({
      where: { id, workspaceId: requireWorkspaceId() },
      select: { executionMode: true, agentWorkflow: true }
    });
    return {
      agentId: id,
      executionMode: agent.executionMode,
      workflow: agent.agentWorkflow
        ? {
            workflowId: agent.agentWorkflow.workflowId,
            workflowVersionId: agent.agentWorkflow.workflowVersionId
          }
        : null
    };
  }

  /**
   * WORKFLOW 模式只允许绑定 WorkflowsService 确认过的当前发布版本；切回自主循环会删除绑定，
   * 避免运行时同时看到两套互相矛盾的执行配置。
   */
  async updateAgentWorkflow(
    id: string,
    payload: AgentWorkflowBindingDto
  ): Promise<AgentWorkflowBindingResult> {
    await this.ensureCanManageAgent(id);
    const executionMode = this.normalizeExecutionMode(payload.executionMode);

    if (executionMode === AgentExecutionMode.AGENT_LOOP) {
      // 执行模式与 Workflow 绑定必须原子切换，避免 Agent Loop 仍残留可执行工作流。
      await this.prisma.$transaction([
        this.prisma.agentWorkflow.deleteMany({ where: { agentId: id } }),
        this.prisma.agent.update({
          where: { id, workspaceId: requireWorkspaceId() },
          data: { executionMode: AgentExecutionMode.AGENT_LOOP }
        })
      ]);
      return { agentId: id, executionMode, workflow: null };
    }

    const workflowId = this.requireNonEmptyString(payload.workflowId, "workflowId");
    const workflowVersionId = this.requireNonEmptyString(
      payload.workflowVersionId,
      "workflowVersionId"
    );
    await this.workflowsService.getPublishedRuntimeConfig(workflowId, workflowVersionId);
    // 绑定不可变版本与切换执行模式必须同时成功，防止 WORKFLOW 模式缺少运行配置。
    await this.prisma.$transaction([
      this.prisma.agentWorkflow.upsert({
        where: { agentId: id },
        create: { agentId: id, workflowId, workflowVersionId },
        update: { workflowId, workflowVersionId }
      }),
      this.prisma.agent.update({
        where: { id, workspaceId: requireWorkspaceId() },
        data: { executionMode: AgentExecutionMode.WORKFLOW }
      })
    ]);
    return {
      agentId: id,
      executionMode,
      workflow: { workflowId, workflowVersionId }
    };
  }

  /** 原子替换工具绑定；写入前确认工具存在且可绑定。 */
  async updateAgentTools(
    id: string,
    payload: AgentToolBindingDto
  ): Promise<AgentToolBindingResult> {
    await this.ensureCanManageAgent(id);
    const toolIds = this.normalizeToolIds(payload.toolIds);
    await this.ensureToolIdsExist(toolIds);

    // 工具绑定采用全量替换，删除旧集合和写入新集合必须在同一事务内完成。
    await this.prisma.$transaction([
      this.prisma.agentTool.deleteMany({
        where: {
          agentId: id
        }
      }),
      ...(toolIds.length > 0
        ? [
            this.prisma.agentTool.createMany({
              data: toolIds.map((toolId) => ({
                agentId: id,
                toolId
              }))
            })
          ]
        : [])
    ]);

    return {
      agentId: id,
      toolIds
    };
  }

  /** 读取 Agent Skill 绑定，始终按 position 返回。 */
  async getAgentSkills(id: string): Promise<AgentSkillBindingResult> {
    await this.ensureCanManageAgent(id);
    const skills = await this.prisma.agentSkill.findMany({
      where: { agentId: id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { skillId: "asc" }]
    });
    return {
      agentId: id,
      skills: skills.map((binding) => ({
        skillId: binding.skillId,
        position: binding.position,
        enabled: binding.enabled
      }))
    };
  }

  /** 原子替换有序 Skill 绑定；Skill 内容与状态仍由 skills 模块校验。 */
  async updateAgentSkills(
    id: string,
    payload: AgentSkillBindingDto
  ): Promise<AgentSkillBindingResult> {
    await this.ensureCanManageAgent(id);
    const skills = this.normalizeSkillBindings(payload.skills);
    if (!this.skillsService) throw new Error("AgentsService 缺少 SkillsService");
    await this.skillsService.ensureBindableSkillIds(skills.map((binding) => binding.skillId));
    await this.prisma.$transaction([
      this.prisma.agentSkill.deleteMany({ where: { agentId: id } }),
      ...(skills.length > 0
        ? [
            this.prisma.agentSkill.createMany({
              data: skills.map((binding) => ({ agentId: id, ...binding }))
            })
          ]
        : [])
    ]);
    return { agentId: id, skills };
  }

  /** 读取 Agent 已绑定的知识库 ID。 */
  async getAgentKnowledgeBases(id: string): Promise<AgentKnowledgeBaseBindingResult> {
    await this.ensureCanManageAgent(id);

    const knowledgeBases = await this.prisma.agentKnowledgeBase.findMany({
      where: {
        agentId: id
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    return {
      agentId: id,
      knowledgeBaseIds: knowledgeBases.map((knowledgeBase) => knowledgeBase.knowledgeBaseId)
    };
  }

  /** 原子替换知识库绑定；知识库状态与归属由 knowledge 模块校验。 */
  async updateAgentKnowledgeBases(
    id: string,
    payload: AgentKnowledgeBaseBindingDto
  ): Promise<AgentKnowledgeBaseBindingResult> {
    await this.ensureCanManageAgent(id);
    const knowledgeBaseIds = this.normalizeKnowledgeBaseIds(payload.knowledgeBaseIds);
    await this.knowledgeService.ensureKnowledgeBaseIdsExist(knowledgeBaseIds);

    // 知识库绑定采用全量替换，避免并发读取观察到暂时为空的中间状态。
    await this.prisma.$transaction([
      this.prisma.agentKnowledgeBase.deleteMany({
        where: {
          agentId: id
        }
      }),
      ...(knowledgeBaseIds.length > 0
        ? [
            this.prisma.agentKnowledgeBase.createMany({
              data: knowledgeBaseIds.map((knowledgeBaseId) => ({
                agentId: id,
                knowledgeBaseId
              }))
            })
          ]
        : [])
    ]);

    return {
      agentId: id,
      knowledgeBaseIds
    };
  }

  /** 将创建输入归一为可安全写库的数据。 */
  private validateAgentCreate(payload: AgentCreateDto): AgentCreateData {
    return {
      name: this.requireNonEmptyString(payload.name, "name"),
      description: this.normalizeDescription(payload.description),
      systemPrompt: this.requireNonEmptyString(payload.systemPrompt, "systemPrompt"),
      modelConfigId: this.normalizeOptionalId(payload.modelConfigId),
      visionMode: this.normalizeVisionMode(payload.visionMode),
      visionModelConfigId: this.normalizeOptionalId(payload.visionModelConfigId),
      temperature: this.normalizeTemperature(payload.temperature),
      maxTokens: this.normalizeMaxTokens(payload.maxTokens),
      timeoutSeconds: this.normalizeTimeout(payload.timeoutSeconds),
      historyTurns: this.normalizeHistoryTurns(payload.historyTurns),
      chatSessionMode: this.normalizeChatSessionMode(payload.chatSessionMode),
      generationParams: this.normalizeGenerationParams(payload.generationParams),
      thinkingMode: this.normalizeThinkingMode(payload.thinkingMode),
      enabled: payload.enabled ?? true
    };
  }

  /** 仅归一化更新请求中实际出现的字段，避免误覆盖原值。 */
  private validateAgentUpdate(payload: AgentUpdateDto): AgentUpdateData {
    return {
      ...(payload.name !== undefined
        ? { name: this.requireNonEmptyString(payload.name, "name") }
        : {}),
      ...(payload.description !== undefined
        ? { description: this.normalizeDescription(payload.description) }
        : {}),
      ...(payload.systemPrompt !== undefined
        ? { systemPrompt: this.requireNonEmptyString(payload.systemPrompt, "systemPrompt") }
        : {}),
      ...(payload.modelConfigId !== undefined
        ? { modelConfigId: this.requireNonEmptyString(payload.modelConfigId, "modelConfigId") }
        : {}),
      ...(payload.visionMode !== undefined
        ? { visionMode: this.normalizeVisionMode(payload.visionMode) }
        : {}),
      ...(payload.visionModelConfigId !== undefined
        ? { visionModelConfigId: this.normalizeOptionalId(payload.visionModelConfigId) }
        : {}),
      ...(payload.temperature !== undefined
        ? { temperature: this.normalizeTemperature(payload.temperature) }
        : {}),
      ...(payload.maxTokens !== undefined
        ? { maxTokens: this.normalizeMaxTokens(payload.maxTokens) }
        : {}),
      ...(payload.timeoutSeconds !== undefined
        ? { timeoutSeconds: this.normalizeTimeout(payload.timeoutSeconds) }
        : {}),
      ...(payload.historyTurns !== undefined
        ? { historyTurns: this.normalizeHistoryTurns(payload.historyTurns) }
        : {}),
      ...(payload.chatSessionMode !== undefined
        ? { chatSessionMode: this.normalizeChatSessionMode(payload.chatSessionMode) }
        : {}),
      ...(payload.generationParams !== undefined
        ? { generationParams: this.normalizeGenerationParams(payload.generationParams) }
        : {}),
      ...(payload.thinkingMode !== undefined
        ? { thinkingMode: this.normalizeThinkingMode(payload.thinkingMode) }
        : {}),
      ...(payload.enabled !== undefined ? { enabled: Boolean(payload.enabled) } : {})
    };
  }

  private requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new AppError(ErrorCodes.common.badRequest, `${field} is required`);
    }

    return value.trim();
  }

  private normalizeOptionalId(value: unknown): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    return this.requireNonEmptyString(value, "modelConfigId");
  }

  private normalizeThinkingMode(value: unknown): ModelThinkingMode {
    if (value === undefined || value === null) return ModelThinkingMode.AUTO;
    if (
      value === ModelThinkingMode.AUTO ||
      value === ModelThinkingMode.ENABLED ||
      value === ModelThinkingMode.DISABLED
    ) {
      return value;
    }
    throw new AppError(ErrorCodes.common.badRequest, "thinkingMode is invalid");
  }

  private normalizeVisionMode(value: unknown): AgentVisionMode {
    if (value === undefined || value === null) return AgentVisionMode.AUTO;
    if (Object.values(AgentVisionMode).includes(value as AgentVisionMode)) {
      return value as AgentVisionMode;
    }
    throw new AppError(ErrorCodes.common.badRequest, "visionMode is invalid");
  }

  private async ensureVisionPolicy(
    mode: AgentVisionMode,
    visionModelConfigId: string | null
  ): Promise<void> {
    if (mode === AgentVisionMode.DEDICATED) {
      if (!visionModelConfigId) {
        throw new AppError(
          ErrorCodes.agent.invalidModelConfig,
          "DEDICATED visionMode requires visionModelConfigId"
        );
      }
      await this.modelProvidersService.ensureVisionModelConfig(visionModelConfigId);
    }
  }

  /** 不支持思考覆盖的模型始终保持供应商默认；可选模型才接受 Agent 覆盖。 */
  private resolveThinkingMode(
    agentMode: ModelThinkingMode,
    thinkingSupported: boolean,
    modelMode: ModelThinkingMode
  ): ModelThinkingMode {
    if (!thinkingSupported) return ModelThinkingMode.AUTO;
    return agentMode === ModelThinkingMode.AUTO ? modelMode : agentMode;
  }

  private normalizeDescription(value: unknown): string {
    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value !== "string") {
      throw new AppError(ErrorCodes.common.badRequest, "description must be a string");
    }

    return value.trim();
  }

  private normalizeTemperature(value: unknown): number {
    if (value === undefined || value === null || value === "") {
      return DEFAULT_TEMPERATURE;
    }

    const temperature = Number(value);

    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "temperature must be a number between 0 and 2"
      );
    }

    return Number(temperature.toFixed(2));
  }

  private normalizeMaxTokens(value: unknown): number | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    const maxTokens = Number(value);

    if (!Number.isInteger(maxTokens) || maxTokens < 1) {
      throw new AppError(ErrorCodes.common.badRequest, "maxTokens must be a positive integer");
    }

    return maxTokens;
  }

  private normalizeTimeout(value: unknown): number {
    if (value === undefined || value === null || value === "") {
      return DEFAULT_TIMEOUT_SECONDS;
    }

    const timeout = Number(value);

    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "timeoutSeconds must be an integer between 1 and 300"
      );
    }

    return timeout;
  }

  private normalizeHistoryTurns(value: unknown): number {
    if (value === undefined || value === null || value === "") {
      return DEFAULT_HISTORY_TURNS;
    }

    const historyTurns = Number(value);

    if (!Number.isInteger(historyTurns) || historyTurns < 0 || historyTurns > 20) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "historyTurns must be an integer between 0 and 20"
      );
    }

    return historyTurns;
  }

  /**
   * 仅允许两种显式会话策略，避免把任意字符串静默写入 Agent 配置。
   * 未提供时沿用单次会话，确保已有配置的行为不变。
   */
  private normalizeChatSessionMode(value: unknown): AgentChatSessionMode {
    if (value === undefined || value === null || value === "") {
      return AgentChatSessionMode.EPHEMERAL;
    }

    if (value === AgentChatSessionMode.EPHEMERAL || value === AgentChatSessionMode.PERSISTENT) {
      return value;
    }

    throw new AppError(
      ErrorCodes.common.badRequest,
      "chatSessionMode must be EPHEMERAL or PERSISTENT"
    );
  }

  private normalizeExecutionMode(value: unknown): AgentExecutionMode {
    if (value === AgentExecutionMode.AGENT_LOOP || value === AgentExecutionMode.WORKFLOW) {
      return value;
    }
    throw new AppError(
      ErrorCodes.common.badRequest,
      "executionMode must be AGENT_LOOP or WORKFLOW"
    );
  }

  private normalizeGenerationParams(value: unknown): AgentGenerationParams | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (!this.isPlainObject(value)) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "generationParams must be an object or null"
      );
    }

    return value;
  }

  /** 规范化工具 ID、去重并拒绝非字符串成员。 */
  private normalizeToolIds(value: unknown): string[] {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new AppError(ErrorCodes.agent.invalidTools, "toolIds must be an array");
    }

    const toolIds = value.map((item) => {
      if (typeof item !== "string" || item.trim().length === 0) {
        throw new AppError(ErrorCodes.agent.invalidTools, "toolIds must contain non-empty strings");
      }

      return item.trim();
    });

    if (toolIds.length > 50) {
      throw new AppError(ErrorCodes.agent.invalidTools, "toolIds cannot exceed 50 items");
    }

    return [...new Set(toolIds)];
  }

  private normalizeSkillBindings(
    value: AgentSkillBindingDto["skills"]
  ): AgentSkillBindingResult["skills"] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      throw new AppError(ErrorCodes.agent.invalidSkills, "skills must be an array");
    }
    if (value.length > MAX_AGENT_SKILLS) {
      throw new AppError(
        ErrorCodes.agent.tooManySkills,
        `Agent 最多绑定 ${MAX_AGENT_SKILLS} 个 Skill`
      );
    }
    const seen = new Set<string>();
    return value.map((item, index) => {
      const skillId = this.requireNonEmptyString(item?.skillId, "skillId");
      if (seen.has(skillId)) {
        throw new AppError(ErrorCodes.agent.invalidSkills, "skillId cannot be duplicated");
      }
      if (item.position !== undefined && item.position !== index) {
        throw new AppError(
          ErrorCodes.agent.invalidSkills,
          "Skill position must match its array index"
        );
      }
      seen.add(skillId);
      return { skillId, position: index, enabled: item.enabled ?? true };
    });
  }

  /** 规范化知识库 ID、去重并拒绝非字符串成员。 */
  private normalizeKnowledgeBaseIds(value: unknown): string[] {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new AppError(
        ErrorCodes.agent.invalidKnowledgeBases,
        "knowledgeBaseIds must be an array"
      );
    }

    const knowledgeBaseIds = value.map((item) => {
      if (typeof item !== "string" || item.trim().length === 0) {
        throw new AppError(
          ErrorCodes.agent.invalidKnowledgeBases,
          "knowledgeBaseIds must contain non-empty strings"
        );
      }

      return item.trim();
    });

    if (knowledgeBaseIds.length > 50) {
      throw new AppError(
        ErrorCodes.agent.invalidKnowledgeBases,
        "knowledgeBaseIds cannot exceed 50 items"
      );
    }

    return [...new Set(knowledgeBaseIds)];
  }

  /** 普通工具由 tools 校验，版本化 Workflow Tool 由 workflows 校验。 */
  private async ensureToolIdsExist(toolIds: string[]): Promise<void> {
    if (toolIds.length === 0) {
      return;
    }

    const workflowToolIds = toolIds.filter((toolId) => toolId.startsWith("workflow:"));
    const regularToolIds = toolIds.filter((toolId) => !toolId.startsWith("workflow:"));
    const [regularTools, workflowTools] = await Promise.all([
      this.toolsService.getToolDefinitions(regularToolIds),
      workflowToolIds.length
        ? this.workflowsService.getWorkflowToolDefinitions(workflowToolIds)
        : Promise.resolve([])
    ]);
    const availableToolIds = new Set([...regularTools, ...workflowTools].map((tool) => tool.id));
    const missingToolIds = toolIds.filter((toolId) => !availableToolIds.has(toolId));

    if (missingToolIds.length > 0) {
      throw new AppError(
        ErrorCodes.agent.invalidTools,
        `unknown or disabled toolIds: ${missingToolIds.join(", ")}`
      );
    }
  }

  /** 将查询字符串严格解析为布尔值。 */
  private parseEnabled(value: string): boolean {
    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }

    throw new AppError(ErrorCodes.common.badRequest, "enabled must be true or false");
  }

  /** 确认 Agent 属于当前空间，且当前成员是创建者或项目管理者。 */
  private async ensureCanManageAgent(id: string): Promise<void> {
    const existing = await this.prisma.agent.findFirst({
      where: {
        id,
        ...(getWorkspaceId() ? { workspaceId: getWorkspaceId()! } : {}),
        deletedAt: null
      },
      select: {
        id: true,
        createdByUserId: true
      }
    });

    if (!existing) {
      throw new AppError(ErrorCodes.agent.notFound, "agent not found", HttpStatus.NOT_FOUND);
    }
    this.assertCanManageAgent(existing.createdByUserId);
  }

  private assertCanManageAgent(createdByUserId: string): void {
    const actor = requireWorkspaceActor();
    if (
      actor.role !== WorkspaceRole.OWNER &&
      actor.role !== WorkspaceRole.MANAGER &&
      actor.userId !== createdByUserId
    ) {
      throw new AppError(
        ErrorCodes.workspace.forbidden,
        "只能管理自己创建的 Agent",
        HttpStatus.FORBIDDEN
      );
    }
  }

  /** 生成具有足够熵的 URL 安全分享令牌。 */
  private createShareToken(): string {
    return randomBytes(18).toString("base64url");
  }

  /** 创建时解析显式模型配置或系统默认 Chat 模型。 */
  private async resolveCreateModelConfigId(modelConfigId: string | null): Promise<string> {
    if (modelConfigId) {
      return modelConfigId;
    }

    const defaultModelConfigId = await this.modelProvidersService.getDefaultChatModelConfigId();

    if (!defaultModelConfigId) {
      throw new AppError(
        ErrorCodes.agent.invalidModelConfig,
        "default chat model is not configured"
      );
    }

    return defaultModelConfigId;
  }

  /** 委托模型模块确认配置存在、启用且类型为 Chat。 */
  private async ensureChatModelConfig(id: string): Promise<void> {
    const modelConfig = await this.prisma.modelConfig.findFirst({
      where: {
        id,
        ...(getWorkspaceId() ? { workspaceId: getWorkspaceId()! } : {}),
        deletedAt: null,
        enabled: true,
        modelType: ModelConfigType.CHAT,
        provider: {
          deletedAt: null,
          enabled: true
        }
      },
      select: {
        id: true
      }
    });

    if (!modelConfig) {
      throw new AppError(
        ErrorCodes.agent.invalidModelConfig,
        "modelConfigId must reference an enabled chat model"
      );
    }
  }

  private getAgentKnowledgeBaseInclude() {
    return {
      include: {
        knowledgeBase: {
          select: {
            enabled: true,
            deletedAt: true
          }
        }
      }
    } satisfies Prisma.AgentKnowledgeBaseDefaultArgs;
  }

  private isActiveAgentKnowledgeBase(
    knowledgeBase: AgentWithModelConfig["agentKnowledgeBases"][number]
  ): boolean {
    return knowledgeBase.knowledgeBase.enabled && !knowledgeBase.knowledgeBase.deletedAt;
  }

  /** 查询 Agent 详情并集中维护关联加载范围。 */
  private async findAgentDetail(id: string): Promise<AgentWithModelConfig> {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id,
        ...(getWorkspaceId() ? { workspaceId: getWorkspaceId()! } : {}),
        deletedAt: null
      },
      include: {
        modelConfig: {
          include: {
            provider: true
          }
        },
        createdBy: { select: { id: true, displayName: true } },
        agentTools: true,
        agentSkills: true,
        agentWorkflow: true,
        agentKnowledgeBases: this.getAgentKnowledgeBaseInclude(),
        _count: {
          select: {
            agentTools: true,
            agentSkills: true,
            agentKnowledgeBases: true
          }
        }
      }
    });

    if (!agent) {
      throw new AppError(ErrorCodes.agent.notFound, "agent not found", HttpStatus.NOT_FOUND);
    }

    return agent;
  }

  /** 将模块内部 Prisma 投影转换为列表 DTO。 */
  private toAgentListItem(agent: AgentWithModelConfig): AgentListItem {
    return {
      id: agent.id,
      creator: {
        id: agent.createdBy.id,
        displayName: agent.createdBy.displayName
      },
      permissions: this.getAgentPermissions(agent.createdByUserId),
      name: agent.name,
      description: agent.description,
      modelConfigId: agent.modelConfigId,
      modelName: agent.modelConfig.modelName,
      providerName: agent.modelConfig.provider.name,
      toolCount: agent._count.agentTools,
      skillCount: agent._count.agentSkills ?? 0,
      knowledgeBaseCount: agent.agentKnowledgeBases.filter((knowledgeBase) =>
        this.isActiveAgentKnowledgeBase(knowledgeBase)
      ).length,
      temperature: Number(agent.temperature),
      historyTurns: agent.historyTurns,
      chatSessionMode: agent.chatSessionMode,
      executionMode: agent.executionMode,
      enabled: agent.enabled,
      published: agent.published,
      publishedAt: agent.publishedAt,
      shareToken: agent.shareToken,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt
    };
  }

  private getAgentPermissions(createdByUserId: string): AgentListItem["permissions"] {
    const actor = requireWorkspaceActor();
    const canManage =
      actor.role === WorkspaceRole.OWNER ||
      actor.role === WorkspaceRole.MANAGER ||
      actor.userId === createdByUserId;
    return { canEdit: canManage, canDelete: canManage, canPublish: canManage };
  }

  /** 将模块内部 Prisma 投影转换为详情 DTO。 */
  private toAgentDetail(agent: AgentWithModelConfig): AgentDetail {
    return {
      ...this.toAgentListItem(agent),
      systemPrompt: agent.systemPrompt,
      maxTokens: agent.maxTokens,
      timeoutSeconds: agent.timeoutSeconds,
      historyTurns: agent.historyTurns,
      chatSessionMode: agent.chatSessionMode,
      generationParams: this.toGenerationParams(agent.generationParams),
      thinkingMode: agent.thinkingMode,
      visionMode: agent.visionMode,
      visionModelConfigId: agent.visionModelConfigId,
      toolIds: agent.agentTools.map((tool) => tool.toolId),
      knowledgeBaseIds: agent.agentKnowledgeBases.map(
        (knowledgeBase) => knowledgeBase.knowledgeBaseId
      ),
      skillIds: [...(agent.agentSkills ?? [])]
        .sort((left, right) => left.position - right.position)
        .map((binding) => binding.skillId),
      modelConfig: this.toModelConfigSummary(agent),
      workflow: agent.agentWorkflow
        ? {
            workflowId: agent.agentWorkflow.workflowId,
            workflowVersionId: agent.agentWorkflow.workflowVersionId
          }
        : null
    };
  }

  private toModelConfigSummary(agent: AgentWithModelConfig): AgentModelConfigSummary {
    return {
      id: agent.modelConfig.id,
      modelName: agent.modelConfig.modelName,
      modelType: agent.modelConfig.modelType,
      providerId: agent.modelConfig.providerId,
      providerName: agent.modelConfig.provider.name,
      providerType: agent.modelConfig.provider.providerType
    };
  }

  private toGenerationParams(value: Prisma.JsonValue | null): AgentGenerationParams | null {
    if (!this.isPlainObject(value)) {
      return null;
    }

    return value;
  }

  private toPrismaJson(
    value: AgentGenerationParams | null
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    return value === null ? Prisma.JsonNull : value;
  }

  private isPlainObject(value: unknown): value is AgentGenerationParams {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  }
}
