import {
  EvaluationCaseSourceType,
  EvaluationDatasetStatus,
  EvaluationDatasetVersionStatus,
  EvaluationRunStatus
} from "@prisma/client";

export type EvaluationDatasetQueryDto = {
  page?: string;
  pageSize?: string;
  keyword?: string;
  status?: EvaluationDatasetStatus;
};

export type CreateEvaluationDatasetDto = {
  name?: string;
  description?: string;
};

export type UpdateEvaluationDatasetDto = Partial<CreateEvaluationDatasetDto>;

export type CreateEvaluationVersionDto = {
  sourceVersionId?: string;
};

export type EvaluationCaseQueryDto = {
  page?: string;
  pageSize?: string;
  keyword?: string;
  category?: string;
};

export type CreateEvaluationCaseDto = {
  question?: string;
  expectedAnswer?: string | null;
  expectedDocumentIds?: string[];
  expectedChunkIds?: string[];
  answerable?: boolean;
  category?: string | null;
  difficulty?: string | null;
  sourceType?: EvaluationCaseSourceType;
  sourceFeedbackId?: string | null;
};

export type UpdateEvaluationCaseDto = CreateEvaluationCaseDto;

export type FreezeEvaluationVersionDto = {
  expectedRevision?: number;
};

export type UploadedEvaluationFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

export type CommitEvaluationImportDto = {
  importToken?: string;
  onlyValidRows?: boolean;
};

export type CreateEvaluationRunDto = {
  datasetVersionId?: string;
  agentId?: string;
  baselineRunId?: string | null;
  overrides?: { retrieval?: { topK?: number; scoreThreshold?: number } };
};

export type EvaluationRunQueryDto = {
  page?: string;
  pageSize?: string;
  status?: EvaluationRunStatus;
  datasetVersionId?: string;
  agentId?: string;
};

export type EvaluationRunResultQueryDto = { page?: string; pageSize?: string };

export type EvaluationComparisonQueryDto = {
  baselineRunId?: string;
  candidateRunId?: string;
};

export type EvaluationVersionSummary = {
  id: string;
  version: number;
  status: EvaluationDatasetVersionStatus;
  revision: number;
  caseCount: number;
  frozenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EvaluationDatasetListItem = {
  id: string;
  name: string;
  description: string;
  status: EvaluationDatasetStatus;
  latestVersion: EvaluationVersionSummary | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EvaluationDatasetDetail = EvaluationDatasetListItem & {
  versions: EvaluationVersionSummary[];
};
