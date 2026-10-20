import { request, type PageResult } from "../../shared/api/client";

export type EvaluationDatasetStatus = "ACTIVE" | "ARCHIVED";
export type EvaluationVersionStatus = "DRAFT" | "FROZEN";

export type EvaluationVersion = {
  id: string;
  version: number;
  status: EvaluationVersionStatus;
  revision: number;
  caseCount: number;
  frozenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EvaluationDataset = {
  id: string;
  name: string;
  description: string;
  status: EvaluationDatasetStatus;
  latestVersion: EvaluationVersion | null;
  createdAt: string;
  updatedAt: string;
};

export type EvaluationDatasetDetail = EvaluationDataset & { versions: EvaluationVersion[] };

export type EvaluationCase = {
  id: string;
  datasetVersionId: string;
  question: string;
  expectedAnswer: string | null;
  expectedDocumentIds: string[];
  expectedChunkIds: string[];
  answerable: boolean;
  category: string | null;
  difficulty: string | null;
  sourceType: "MANUAL" | "IMPORT" | "ONLINE_FEEDBACK";
  createdAt: string;
  updatedAt: string;
};

export type EvaluationCaseInput = {
  question: string;
  expectedAnswer?: string | null;
  expectedDocumentIds?: string[];
  expectedChunkIds?: string[];
  answerable?: boolean;
  category?: string | null;
  difficulty?: string | null;
};

function queryString(values: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return params.toString();
}

export function listEvaluationDatasets(query: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: EvaluationDatasetStatus;
}): Promise<PageResult<EvaluationDataset>> {
  return request(`/api/v1/evaluations/datasets?${queryString(query)}`);
}

export function createEvaluationDataset(payload: { name: string; description?: string }) {
  return request<EvaluationDatasetDetail>("/api/v1/evaluations/datasets", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getEvaluationDataset(datasetId: string) {
  return request<EvaluationDatasetDetail>(`/api/v1/evaluations/datasets/${datasetId}`);
}

export function createEvaluationVersion(datasetId: string, sourceVersionId?: string) {
  return request<EvaluationVersion>(`/api/v1/evaluations/datasets/${datasetId}/versions`, {
    method: "POST",
    body: JSON.stringify({ sourceVersionId })
  });
}

export function listEvaluationCases(
  versionId: string,
  query: { page?: number; pageSize?: number; keyword?: string; category?: string }
): Promise<PageResult<EvaluationCase>> {
  return request(`/api/v1/evaluations/dataset-versions/${versionId}/cases?${queryString(query)}`);
}

export function createEvaluationCase(versionId: string, payload: EvaluationCaseInput) {
  return request<EvaluationCase>(`/api/v1/evaluations/dataset-versions/${versionId}/cases`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateEvaluationCase(
  versionId: string,
  caseId: string,
  payload: EvaluationCaseInput
) {
  return request<EvaluationCase>(
    `/api/v1/evaluations/dataset-versions/${versionId}/cases/${caseId}`,
    { method: "PATCH", body: JSON.stringify(payload) }
  );
}

export function deleteEvaluationCase(versionId: string, caseId: string) {
  return request<null>(`/api/v1/evaluations/dataset-versions/${versionId}/cases/${caseId}`, {
    method: "DELETE"
  });
}

export function freezeEvaluationVersion(versionId: string, expectedRevision: number) {
  return request<EvaluationVersion>(`/api/v1/evaluations/dataset-versions/${versionId}/freeze`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision })
  });
}
