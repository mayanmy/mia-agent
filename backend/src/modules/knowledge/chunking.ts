/** 保存到知识库的单个文本切片。 */
export type KnowledgeChunkInput = {
  /** 文档内从 0 开始的稳定顺序。 */
  chunkIndex: number;
  /** 已去除首尾空白的切片正文。 */
  content: string;
  /** 轻量估算值，仅用于容量统计，不作为模型精确计费。 */
  tokenCount: number;
};

/** 文本切分参数，单位为字符而非模型 token。 */
export type ChunkTextOptions = {
  chunkSize?: number;
  overlap?: number;
};

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_OVERLAP = 120;

export function chunkText(text: string, options: ChunkTextOptions = {}): KnowledgeChunkInput[] {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return [];
  }

  const chunkSize = normalizePositiveInteger(options.chunkSize, DEFAULT_CHUNK_SIZE);
  // overlap 必须小于 chunkSize，否则游标无法前进并会形成死循环。
  const overlap = Math.min(
    normalizePositiveInteger(options.overlap, DEFAULT_OVERLAP),
    chunkSize - 1
  );
  const chunks: KnowledgeChunkInput[] = [];
  let start = 0;

  while (start < normalizedText.length) {
    const hardEnd = Math.min(start + chunkSize, normalizedText.length);
    const end = findChunkEnd(normalizedText, start, hardEnd);
    const content = normalizedText.slice(start, end).trim();

    if (content) {
      chunks.push({
        chunkIndex: chunks.length,
        content,
        tokenCount: estimateTokenCount(content)
      });
    }

    if (end >= normalizedText.length) {
      break;
    }

    // start + 1 是兜底前进量，防止异常断点使下一轮重复相同区间。
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function findChunkEnd(text: string, start: number, hardEnd: number): number {
  if (hardEnd >= text.length) {
    return text.length;
  }

  const slice = text.slice(start, hardEnd);
  const paragraphBreak = slice.lastIndexOf("\n\n");

  // 只在窗口后半段采用自然边界，避免为了完整段落产生过小切片。
  if (paragraphBreak >= Math.floor(slice.length * 0.5)) {
    return start + paragraphBreak + 2;
  }

  const lineBreak = slice.lastIndexOf("\n");

  if (lineBreak >= Math.floor(slice.length * 0.6)) {
    return start + lineBreak + 1;
  }

  const sentenceBreak = Math.max(
    slice.lastIndexOf("。"),
    slice.lastIndexOf("."),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?")
  );

  if (sentenceBreak >= Math.floor(slice.length * 0.7)) {
    return start + sentenceBreak + 1;
  }

  return hardEnd;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function estimateTokenCount(value: string): number {
  // V1 不绑定特定 tokenizer，以 4 字符/token 提供稳定且低成本的容量近似。
  return Math.max(1, Math.ceil(value.length / 4));
}
