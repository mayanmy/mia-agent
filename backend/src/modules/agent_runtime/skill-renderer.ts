import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";

import type { AgentRuntimeConfig } from "../agents/dto/agent.dto";

export const MAX_SINGLE_SKILL_PROMPT_CHARS = 12_000;
export const MAX_TOTAL_SKILL_PROMPT_CHARS = 30_000;

type RuntimeSkill = AgentRuntimeConfig["skills"][number];

export type SkillPromptRenderResult = {
  prompt: string;
  applied: Array<{
    skillId: string;
    revision: number;
    position: number;
    renderedChars: number;
  }>;
  skipped: Array<{
    skillId: string;
    reason: "DISABLED_OR_ARCHIVED" | "PROMPT_BUDGET_EXCEEDED";
  }>;
  totalRenderedChars: number;
  promptHash: string;
};

@Injectable()
export class SkillPromptRenderer {
  render(
    skills: RuntimeSkill[],
    unavailable: AgentRuntimeConfig["unavailableSkillBindings"]
  ): SkillPromptRenderResult {
    const ordered = [...skills].sort(
      (left, right) => left.position - right.position || left.id.localeCompare(right.id)
    );
    const rendered: string[] = [];
    const applied: SkillPromptRenderResult["applied"] = [];
    const skipped: SkillPromptRenderResult["skipped"] = unavailable.map((binding) => ({
      skillId: binding.skillId,
      reason: binding.reason
    }));
    const heading = "已启用 Skill（按配置顺序执行；与 Agent 规则冲突时以 Agent 规则为准）：\n\n";
    let remaining = MAX_TOTAL_SKILL_PROMPT_CHARS - heading.length;

    for (const skill of ordered) {
      if (remaining <= 0) {
        skipped.push({ skillId: skill.id, reason: "PROMPT_BUDGET_EXCEEDED" });
        continue;
      }
      const block = this.renderSkill(skill);
      const separatorChars = rendered.length > 0 ? 2 : 0;
      const limit = Math.min(MAX_SINGLE_SKILL_PROMPT_CHARS, remaining - separatorChars);
      if (limit <= "\n[内容已裁剪]".length) {
        skipped.push({ skillId: skill.id, reason: "PROMPT_BUDGET_EXCEEDED" });
        continue;
      }
      const content =
        block.length > limit
          ? `${block.slice(0, Math.max(0, limit - "\n[内容已裁剪]".length))}\n[内容已裁剪]`
          : block;
      if (!content.trim()) {
        skipped.push({ skillId: skill.id, reason: "PROMPT_BUDGET_EXCEEDED" });
        continue;
      }
      rendered.push(content);
      applied.push({
        skillId: skill.id,
        revision: skill.revision,
        position: skill.position,
        renderedChars: content.length
      });
      remaining -= content.length + separatorChars;
    }

    const prompt = rendered.length ? `${heading}${rendered.join("\n\n")}` : "";
    return {
      prompt,
      applied,
      skipped,
      totalRenderedChars: prompt.length,
      promptHash: `sha256:${createHash("sha256").update(prompt).digest("hex")}`
    };
  }

  private renderSkill(skill: RuntimeSkill): string {
    const lines = [
      `<skill id="${this.escape(skill.id)}" name="${this.escape(skill.name)}" revision="${skill.revision}" position="${skill.position}">`,
      ...this.field("适用条件", skill.usageConditions),
      ...this.field("执行说明", skill.instructions),
      ...this.field("输入要求", skill.inputGuidance),
      ...this.field("输出要求", skill.outputGuidance),
      ...this.field("限制", skill.limitations),
      "</skill>"
    ];
    return lines.join("\n");
  }

  private field(label: string, value: string): string[] {
    const normalized = value.trim();
    return normalized ? [`${label}：${this.escape(normalized)}`] : [];
  }

  private escape(value: string): string {
    return value
      .replace(/&/gu, "&amp;")
      .replace(/<\/?skill/giu, (match) => match.replace("<", "&lt;"))
      .replace(/"/gu, "&quot;");
  }
}
