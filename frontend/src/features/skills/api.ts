import { request, type PageResult } from "../../shared/api/client";

export type SkillDetail = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  usageConditions: string;
  inputGuidance: string;
  outputGuidance: string;
  limitations: string;
  enabled: boolean;
  revision: number;
  sourceType: string;
  sourceRef?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

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
