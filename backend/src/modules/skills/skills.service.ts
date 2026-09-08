import { createHash, randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { createPageResult, normalizePageQuery } from "../../core/pagination";
import type { PageResult } from "../../core/result";
import { PrismaService } from "../prisma/prisma.service";
import type {
  ImportedSkillDraftDto,
  SkillCreateDto,
  SkillDetail,
  SkillQueryDto,
  SkillStatusDto,
  SkillUpdateDto
} from "./dto/skill.dto";

@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService) {}

  async listSkills(query: SkillQueryDto): Promise<PageResult<SkillDetail>> {
    const page = normalizePageQuery(query);
    const keyword = String(query.keyword ?? "")
      .trim()
      .slice(0, 100);
    const where: Prisma.SkillWhereInput = {
      deletedAt: null,
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: "insensitive" } },
              { description: { contains: keyword, mode: "insensitive" } }
            ]
          }
        : {}),
      ...(query.enabled === undefined ? {} : { enabled: this.boolean(query.enabled) })
    };
    // Skill 列表与总数共用同一事务快照，避免编辑状态变化造成分页口径不一致。
    const [items, total] = await this.prisma.$transaction([
      this.prisma.skill.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: page.skip,
        take: page.take
      }),
      this.prisma.skill.count({ where })
    ]);
    return createPageResult(
      items.map((item) => this.toDetail(item)),
      total,
      page.page,
      page.pageSize
    );
  }

  async getSkill(id: string): Promise<SkillDetail> {
    return this.toDetail(await this.requireSkill(id));
  }

  async createSkill(payload: SkillCreateDto, userId: string): Promise<SkillDetail> {
    const data = this.content(payload);
    const skill = await this.prisma.skill.create({
      data: { id: randomUUID(), ...data, enabled: payload.enabled ?? true, createdByUserId: userId }
    });
    return this.toDetail(skill);
  }

  /** 外部 Prompt 只创建停用快照；相同来源再次导入也新建草稿，绝不覆盖管理员修改。 */
  async createImportedDraft(payload: ImportedSkillDraftDto, userId: string): Promise<SkillDetail> {
    const data = this.content(payload);
    const sourceHash = createHash("sha256")
      .update(JSON.stringify({ instructions: data.instructions, sourceRef: payload.sourceRef }))
      .digest("hex");
    const skill = await this.prisma.skill.create({
      data: {
        id: randomUUID(),
        ...data,
        enabled: false,
        sourceType: this.text(payload.sourceType, "sourceType", 50),
        sourceRef: payload.sourceRef as Prisma.InputJsonValue,
        sourceHash,
        createdByUserId: userId
      }
    });
    return this.toDetail(skill);
  }

  async updateSkill(id: string, payload: SkillUpdateDto): Promise<SkillDetail> {
    const current = await this.requireSkill(id);
    this.revision(payload.expectedRevision, current.revision);
    const result = await this.prisma.skill.updateMany({
      where: { id, revision: current.revision, deletedAt: null },
      data: {
        ...this.content({ ...current, ...payload }),
        enabled: payload.enabled,
        revision: current.revision + 1
      }
    });
    this.updatedRevision(result.count);
    return this.getSkill(id);
  }

  async updateStatus(id: string, payload: SkillStatusDto): Promise<SkillDetail> {
    const current = await this.requireSkill(id);
    this.revision(payload.expectedRevision, current.revision);
    if (typeof payload.enabled !== "boolean")
      throw new AppError(ErrorCodes.skill.invalidContent, "enabled 必须是布尔值");
    const result = await this.prisma.skill.updateMany({
      where: { id, revision: current.revision, deletedAt: null },
      data: { enabled: payload.enabled, revision: current.revision + 1 }
    });
    this.updatedRevision(result.count);
    return this.getSkill(id);
  }

  async archiveSkill(id: string): Promise<void> {
    await this.requireSkill(id);
    await this.prisma.skill.update({
      where: { id },
      data: { enabled: false, deletedAt: new Date(), revision: { increment: 1 } }
    });
  }

  private content(payload: SkillCreateDto) {
    return {
      name: this.text(payload.name, "name", 80),
      description: this.optional(payload.description, 500),
      instructions: this.text(payload.instructions, "instructions", 8_000),
      usageConditions: this.optional(payload.usageConditions, 2_000),
      inputGuidance: this.optional(payload.inputGuidance, 2_000),
      outputGuidance: this.optional(payload.outputGuidance, 2_000),
      limitations: this.optional(payload.limitations, 2_000)
    };
  }

  private text(value: unknown, field: string, max: number): string {
    const text = String(value ?? "").trim();
    if (!text || text.length > max || [...text].some((char) => char.charCodeAt(0) === 0)) {
      throw new AppError(
        ErrorCodes.skill.invalidContent,
        `${field} 不能为空且不能超过 ${max} 字符`
      );
    }
    return text;
  }

  private optional(value: unknown, max: number): string {
    const text = String(value ?? "").trim();
    if (text.length > max)
      throw new AppError(ErrorCodes.skill.invalidContent, `字段不能超过 ${max} 字符`);
    return text;
  }

  private boolean(value: unknown): boolean {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw new AppError(ErrorCodes.common.badRequest, "enabled 参数不合法");
  }

  private revision(expected: unknown, actual: number): void {
    if (!Number.isInteger(expected) || expected !== actual) {
      throw new AppError(
        ErrorCodes.skill.revisionConflict,
        "Skill 已被其他管理员修改，请刷新后重试",
        409
      );
    }
  }

  private updatedRevision(count: number): void {
    if (count !== 1) {
      throw new AppError(
        ErrorCodes.skill.revisionConflict,
        "Skill 已被其他管理员修改，请刷新后重试",
        409
      );
    }
  }

  private async requireSkill(id: string) {
    const skill = await this.prisma.skill.findFirst({ where: { id, deletedAt: null } });
    if (!skill) throw new AppError(ErrorCodes.skill.notFound, "Skill 不存在", 404);
    return skill;
  }

  private toDetail(skill: Prisma.SkillGetPayload<object>): SkillDetail {
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      usageConditions: skill.usageConditions,
      inputGuidance: skill.inputGuidance,
      outputGuidance: skill.outputGuidance,
      limitations: skill.limitations,
      enabled: skill.enabled,
      revision: skill.revision,
      sourceType: skill.sourceType,
      sourceRef:
        skill.sourceRef && typeof skill.sourceRef === "object" && !Array.isArray(skill.sourceRef)
          ? (skill.sourceRef as Record<string, unknown>)
          : undefined,
      createdAt: skill.createdAt.toISOString(),
      updatedAt: skill.updatedAt.toISOString()
    };
  }
}
