export type KnowledgeChunkInput = {
  chunkIndex: number;
  content: string;
  tokenCount: number;
};

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
  return Math.max(1, Math.ceil(value.length / 4));
}
