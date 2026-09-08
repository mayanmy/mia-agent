import { extname } from "node:path";

/** 当前可安全按 UTF-8 纯文本处理的文件扩展名白名单。 */
const TEXT_DOCUMENT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv", ".json"]);

export function isTextDocument(filename: string): boolean {
  return TEXT_DOCUMENT_EXTENSIONS.has(extname(filename).toLowerCase());
}

export function parseTextDocument(filename: string, buffer: Buffer): string {
  const extension = extname(filename).toLowerCase();
  // 去除 UTF-8 BOM，避免首个标题或 JSON 键携带不可见字符。
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
    // 格式化合法 JSON 可生成稳定切片；非法 JSON 仍按普通文本索引，便于排查原文件。
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function normalizeText(value: string): string {
  // 统一换行且只裁剪行尾，保留 Markdown/代码块依赖的行首缩进。
  return value
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}
