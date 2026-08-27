import type { PageQuery } from "../../../core/pagination";

export type SkillQueryDto = PageQuery & { keyword?: string; enabled?: string | boolean };

export type SkillCreateDto = {
  name?: string;
  description?: string;
  instructions?: string;
  usageConditions?: string;
  inputGuidance?: string;
  outputGuidance?: string;
  limitations?: string;
  enabled?: boolean;
};

export type SkillUpdateDto = SkillCreateDto & { expectedRevision?: number };
export type SkillStatusDto = { enabled?: boolean; expectedRevision?: number };

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

export type ImportedSkillDraftDto = {
  name: string;
  description?: string;
  instructions: string;
  sourceType: string;
  sourceRef: Record<string, unknown>;
};
