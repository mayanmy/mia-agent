import { request, type PageResult } from "../../shared/api/client";

/** Skill 管理页使用的完整详情。 */
export type SkillDetail = {
  /** Skill ID。 */
  id: string;
  /** 展示名称。 */
  name: string;
  /** 用途说明。 */
  description: string;
  /** 注入 Agent 上下文的核心执行说明。 */
  instructions: string;
  /** 模型判断使用时机的条件。 */
  usageConditions: string;
  /** 输入材料约束。 */
  inputGuidance: string;
  /** 输出结构和风格约束。 */
  outputGuidance: string;
  /** 能力边界与禁止事项。 */
  limitations: string;
  /** 是否允许绑定和使用。 */
  enabled: boolean;
  /** 防止并发覆盖的乐观锁修订号。 */
  revision: number;
  /** manual 或 mcp_prompt 等来源类型。 */
  sourceType: string;
  /** 可追溯来源，不包含 MCP 凭据。 */
  sourceRef?: Record<string, unknown>;
  /** ISO 格式创建时间。 */
  createdAt: string;
  /** ISO 格式最近更新时间。 */
  updatedAt: string;
};

/** Skill 创建/编辑表单允许修改的字段。 */
export type SkillFormValues = Pick<
  SkillDetail,
  | "name"
  | "description"
  | "instructions"
  | "usageConditions"
  | "inputGuidance"
  | "outputGuidance"
  | "limitations"
>;

export function listSkills(page = 1, pageSize = 100): Promise<PageResult<SkillDetail>> {
  return request(`/api/v1/skills?page=${page}&pageSize=${pageSize}`);
}

export function createSkill(payload: SkillFormValues): Promise<SkillDetail> {
  return request("/api/v1/skills", { method: "POST", body: JSON.stringify(payload) });
}

export function updateSkill(
  id: string,
  payload: SkillFormValues & { expectedRevision: number }
): Promise<SkillDetail> {
  return request(`/api/v1/skills/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function updateSkillStatus(
  id: string,
  enabled: boolean,
  expectedRevision: number
): Promise<SkillDetail> {
  return request(`/api/v1/skills/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ enabled, expectedRevision })
  });
}

export function archiveSkill(id: string): Promise<null> {
  return request(`/api/v1/skills/${id}`, { method: "DELETE" });
}
