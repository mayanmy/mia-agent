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

/** 生成仅用于浏览器当前会话渲染的消息 ID。 */
export function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 将毫秒时间戳格式化为聊天气泡中的本地时间。 */
export function formatMessageTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

/** 以 Data URL 读取图片，便于预览并直接提交。 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

/** 按 UTF-8 文本读取附件内容。 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

/** 根据 MIME 与扩展名双重判断文本附件，兼容浏览器缺失 MIME 的情况。 */
export function isSupportedTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) {
    return true;
  }

  const lowerName = file.name.toLowerCase();

  return supportedTextFileExtensions.some((extension) => lowerName.endsWith(extension));
}

/** 通过模型命名做保守的视觉能力提示，最终能力仍由后端校验。 */
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

/** 从后向前定位同一工具调用，确保结果更新最近一条 running 事件。 */
export function findLastToolEventIndex(toolEvents: ChatToolEvent[], toolId: string): number {
  for (let index = toolEvents.length - 1; index >= 0; index -= 1) {
    const toolEvent = toolEvents[index];

    if (toolEvent.name === toolId && toolEvent.status === "running") {
      return index;
    }
  }

  return -1;
}

/** 判断滚动位置是否仍接近底部，用于决定流式输出时是否自动跟随。 */
export function isNearScrollBottom(element: HTMLElement): boolean {
  const threshold = 32;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}
