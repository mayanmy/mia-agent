import { extname } from "node:path";

const TEXT_DOCUMENT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv", ".json"]);

export function isTextDocument(filename: string): boolean {
  return TEXT_DOCUMENT_EXTENSIONS.has(extname(filename).toLowerCase());
}

export function parseTextDocument(filename: string, buffer: Buffer): string {
  const extension = extname(filename).toLowerCase();
  const rawText = buffer.toString("utf8").replace(/^\uFEFF/u, "");

  if (!TEXT_DOCUMENT_EXTENSIONS.has(extension)) {
    throw new Error("unsupported text document type");
  }

  const text = extension === ".json" ? normalizeJson(rawText) : rawText;
  const normalized = normalizeText(text);

  if (!normalized) {
    throw new Error("document text is empty");
  }

  return normalized;
}

function normalizeJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}
