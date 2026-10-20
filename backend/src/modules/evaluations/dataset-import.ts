import { createHash } from "node:crypto";

export type ImportedEvaluationCase = {
  line: number;
  question: string;
  expectedAnswer: string | null;
  expectedDocumentIds: string[];
  expectedChunkIds: string[];
  answerable: boolean;
  category: string | null;
  difficulty: string | null;
  questionHash: string;
};

export type EvaluationImportError = { line: number; message: string };

export type EvaluationImportParseResult = {
  rows: ImportedEvaluationCase[];
  errors: EvaluationImportError[];
  totalRows: number;
};

const MAX_IMPORT_ROWS = 5000;
const MAX_QUESTION_LENGTH = 20_000;
const MAX_ANSWER_LENGTH = 50_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** 解析上传文件但不写数据库；所有错误保留原始行号供管理员修复。 */
export function parseEvaluationImport(
  filename: string,
  buffer: Buffer
): EvaluationImportParseResult {
  const text = decodeUtf8(buffer);
  const extension = filename.toLocaleLowerCase().split(".").pop();
  if (extension !== "csv" && extension !== "jsonl") {
    throw new Error("only UTF-8 CSV and JSONL files are supported");
  }
  return extension === "csv" ? parseCsv(text) : parseJsonl(text);
}

function parseJsonl(text: string): EvaluationImportParseResult {
  const lines = text.split(/\r?\n/u);
  const rows: ImportedEvaluationCase[] = [];
  const errors: EvaluationImportError[] = [];
  let totalRows = 0;
  lines.forEach((raw, index) => {
    if (!raw.trim()) return;
    totalRows += 1;
    if (totalRows > MAX_IMPORT_ROWS) return;
    try {
      rows.push(normalizeRow(JSON.parse(raw) as Record<string, unknown>, index + 1));
    } catch (error) {
      errors.push({
        line: index + 1,
        message: error instanceof Error ? error.message : "invalid JSONL row"
      });
    }
  });
  if (totalRows > MAX_IMPORT_ROWS) {
    errors.push({
      line: MAX_IMPORT_ROWS + 1,
      message: `import cannot exceed ${MAX_IMPORT_ROWS} rows`
    });
  }
  return { rows: rows.slice(0, MAX_IMPORT_ROWS), errors, totalRows };
}

function parseCsv(text: string): EvaluationImportParseResult {
  const records = parseCsvRecords(text);
  if (records.length === 0) return { rows: [], errors: [], totalRows: 0 };
  const headers = records[0]!.values.map((value) => value.trim());
  const rows: ImportedEvaluationCase[] = [];
  const errors: EvaluationImportError[] = [];
  const dataRecords = records
    .slice(1)
    .filter((record) => record.values.some((value) => value.trim()));
  dataRecords.slice(0, MAX_IMPORT_ROWS).forEach((record) => {
    const raw = Object.fromEntries(
      headers.map((header, index) => [header, record.values[index] ?? ""])
    );
    try {
      rows.push(normalizeRow(raw, record.line));
    } catch (error) {
      errors.push({
        line: record.line,
        message: error instanceof Error ? error.message : "invalid CSV row"
      });
    }
  });
  if (dataRecords.length > MAX_IMPORT_ROWS) {
    errors.push({
      line: dataRecords[MAX_IMPORT_ROWS]!.line,
      message: `import cannot exceed ${MAX_IMPORT_ROWS} rows`
    });
  }
  return { rows, errors, totalRows: dataRecords.length };
}

/** 最小 RFC 4180 解析器，支持逗号、双引号、转义双引号和字段内换行。 */
function parseCsvRecords(text: string): Array<{ line: number; values: string[] }> {
  const records: Array<{ line: number; values: string[] }> = [];
  let values: string[] = [];
  let value = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(value);
      value = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      values.push(value);
      records.push({ line: recordLine, values });
      values = [];
      value = "";
      line += 1;
      recordLine = line;
      continue;
    }
    value += char;
    if (char === "\n") line += 1;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  if (value || values.length) {
    values.push(value);
    records.push({ line: recordLine, values });
  }
  return records;
}

function normalizeRow(raw: Record<string, unknown>, line: number): ImportedEvaluationCase {
  const question = readString(raw, "question");
  if (!question) throw new Error("question is required");
  if (question.length > MAX_QUESTION_LENGTH) throw new Error("question is too long");
  const expectedAnswer = readString(raw, "expected_answer", "expectedAnswer") || null;
  if (expectedAnswer && expectedAnswer.length > MAX_ANSWER_LENGTH)
    throw new Error("expected_answer is too long");
  return {
    line,
    question,
    expectedAnswer,
    expectedDocumentIds: readStringArray(raw, "expected_document_ids", "expectedDocumentIds"),
    expectedChunkIds: readStringArray(raw, "expected_chunk_ids", "expectedChunkIds"),
    answerable: readBoolean(raw, "answerable", true),
    category: readString(raw, "category") || null,
    difficulty: readString(raw, "difficulty") || null,
    questionHash: createHash("sha256")
      .update(question.replace(/\s+/gu, " ").toLocaleLowerCase())
      .digest("hex")
  };
}

function readString(raw: Record<string, unknown>, ...keys: string[]): string {
  const value = keys.map((key) => raw[key]).find((item) => item !== undefined && item !== null);
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(raw: Record<string, unknown>, ...keys: string[]): string[] {
  const value = keys.map((key) => raw[key]).find((item) => item !== undefined && item !== null);
  if (value === undefined || value === "") return [];
  if (Array.isArray(value)) {
    if (value.some((item) => typeof item !== "string"))
      throw new Error(`${keys[0]} must contain strings`);
    return validateUuidArray(value, keys[0]);
  }
  if (typeof value !== "string")
    throw new Error(`${keys[0]} must be an array or pipe-separated string`);
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error(`${keys[0]} must be a string array`);
    }
    return validateUuidArray(parsed, keys[0]);
  }
  return validateUuidArray(trimmed.split("|"), keys[0]);
}

function validateUuidArray(values: string[], fieldName: string): string[] {
  const normalized = [...new Set(values.map((item) => item.trim()).filter(Boolean))];
  if (normalized.some((item) => !UUID_PATTERN.test(item))) {
    throw new Error(`${fieldName} must contain valid UUIDs`);
  }
  return normalized;
}

function readBoolean(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = raw[key];
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (["true", "1", "yes"].includes(value.toLocaleLowerCase())) return true;
    if (["false", "0", "no"].includes(value.toLocaleLowerCase())) return false;
  }
  throw new Error(`${key} must be true or false`);
}

function decodeUtf8(buffer: Buffer): string {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  return text.replace(/^\uFEFF/u, "");
}
