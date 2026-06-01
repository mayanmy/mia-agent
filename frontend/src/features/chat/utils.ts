import type { ChatToolEvent } from "./types";

export const maxImageSize = 5 * 1024 * 1024;
export const maxFileSize = 1024 * 1024;
export const maxAttachmentCount = 4;
export const supportedTextFileExtensions = [
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".log",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".java",
  ".sql"
];

export function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function formatMessageTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

export function isSupportedTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) {
    return true;
  }

  const lowerName = file.name.toLowerCase();

  return supportedTextFileExtensions.some((extension) => lowerName.endsWith(extension));
}

export function isLikelyVisionModel(modelName: string): boolean {
  const normalized = modelName.toLowerCase();
  const visionModelKeywords = [
    "vl",
    "vision",
    "omni",
    "qvq",
    "gpt-4o",
    "gpt-4.1",
    "gemini",
    "claude-3",
    "claude-4"
  ];

  return visionModelKeywords.some((keyword) => normalized.includes(keyword));
}

export function findLastToolEventIndex(toolEvents: ChatToolEvent[], toolId: string): number {
  for (let index = toolEvents.length - 1; index >= 0; index -= 1) {
    const toolEvent = toolEvents[index];

    if (toolEvent.name === toolId && toolEvent.status === "running") {
      return index;
    }
  }

  return -1;
}

export function isNearScrollBottom(element: HTMLElement): boolean {
  const threshold = 32;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}
