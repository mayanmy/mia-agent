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

export type EvaluationImportPreview = {
  importToken: string;
  expiresAt: string;
  totalRows: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  preview: Array<{
    line: number;
    question: string;
    expectedAnswer: string | null;
    answerable: boolean;
    category: string | null;
    difficulty: string | null;
  }>;
  errors: Array<{ line: number; message: string }>;
};

export type EvaluationRunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";
export type EvaluationSummaryMetrics = {
  retrieval?: { hitRateAt5: number | null; recallAt5: number | null; mrr: number | null; emptyRetrievalRate: number | null };
  runtime?: { successRate: number | null; p95TotalMs: number | null };
  sampleCount?: number;
};
export type EvaluationRun = {
  id: string;
  datasetVersionId: string;
  dataset: { id: string; name: string; version: number };
  agentId: string;
  agentName: string;
  baselineRunId: string | null;
  status: EvaluationRunStatus;
  totalCases: number;
  completedCases: number;
  failedCases: number;
  skippedCases: number;
  summaryMetrics: EvaluationSummaryMetrics | null;
  cancelRequestedAt: string | null;
  heartbeatAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type EvaluationRunDetail = EvaluationRun & {
  agentConfigSnapshot: Record<string, unknown>;
  retrievalConfigSnapshot: Record<string, unknown>;
  modelConfigSnapshot: Record<string, unknown>;
  graderConfigSnapshot: Record<string, unknown>;
  errorType: string | null;
  errorMessage: string | null;
};
export type EvaluationCaseResult = {
  id: string;
  caseId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
  actualAnswer: string | null;
  retrievedChunks: Array<{ documentId: string; documentName: string; chunkId: string; content: string; score: number }> | null;
  retrievalMetrics: { hitRateAt5: number | null; recallAt5: number | null; mrr: number | null; emptyRetrieval: boolean } | null;
  runtimeMetrics: { retrievalMs: number; totalMs: number; totalTokens: number | null } | null;
  errorType: string | null;
  errorMessage: string | null;
  evaluationCase: EvaluationCase;
};
export type EvaluationComparison = {
  baseline: EvaluationRunDetail;
  candidate: EvaluationRunDetail;
  compatibility: { compatible: boolean; reasons: Array<{ field: string; baselineValue: unknown; candidateValue: unknown; message: string }> };
  metrics: Array<{
    key: string;
    label: string;
    direction: "higher_is_better" | "lower_is_better";
    baselineValue: number | null;
    candidateValue: number | null;
    absoluteDelta: number | null;
    relativeDelta: number | null;
    sampleCount: number;
    verdict: "improved" | "regressed" | "unchanged" | "not_comparable";
  }>;
  caseCounts: { improved: number; regressed: number; unchanged: number; mixed: number };
  gateResult: "not_evaluated";
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

export function previewEvaluationImport(versionId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return request<EvaluationImportPreview>(
    `/api/v1/evaluations/dataset-versions/${versionId}/import/preview`,
    { method: "POST", body }
  );
}

export function commitEvaluationImport(
  versionId: string,
  importToken: string,
  onlyValidRows: boolean
) {
  return request<{ importedCount: number; skippedCount: number }>(
    `/api/v1/evaluations/dataset-versions/${versionId}/import/commit`,
    { method: "POST", body: JSON.stringify({ importToken, onlyValidRows }) }
  );
}

export function listEvaluationRuns(query: { page: number; pageSize: number; status?: EvaluationRunStatus }): Promise<PageResult<EvaluationRun>> {
  return request(`/api/v1/evaluations/runs?${queryString(query)}`);
}

export function createEvaluationRun(payload: {
  datasetVersionId: string;
  agentId: string;
  overrides?: { retrieval?: { topK?: number; scoreThreshold?: number } };
}) {
  return request<{ id: string; status: EvaluationRunStatus; totalCases: number; createdAt: string }>("/api/v1/evaluations/runs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function cancelEvaluationRun(runId: string) {
  return request<EvaluationRun>(`/api/v1/evaluations/runs/${runId}/cancel`, { method: "POST" });
}

export function getEvaluationRun(runId: string) {
  return request<EvaluationRunDetail>(`/api/v1/evaluations/runs/${runId}`);
}

export function listEvaluationRunResults(runId: string, page = 1, pageSize = 50) {
  return request<PageResult<EvaluationCaseResult>>(`/api/v1/evaluations/runs/${runId}/results?page=${page}&pageSize=${pageSize}`);
}

export function listCompatibleEvaluationBaselines(runId: string) {
  return request<EvaluationRun[]>(`/api/v1/evaluations/runs/${runId}/compatible-baselines`);
}

export function getEvaluationComparison(baselineRunId: string, candidateRunId: string) {
  return request<EvaluationComparison>(`/api/v1/evaluations/comparisons?${queryString({ baselineRunId, candidateRunId })}`);
}
