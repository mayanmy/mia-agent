/** Agent 最终回答的递归 JSON 值。 */
export type ContentJsonValue =
  string | number | boolean | null | ContentJsonValue[] | { [key: string]: ContentJsonValue };

export type TextContentPart = { type: "text"; text: string };
export type JsonContentPart = { type: "json"; value: ContentJsonValue; title?: string };

/** 二进制内容只引用 Storage 中的对象，不在消息或 SSE 中传输 data URL。 */
export type ImageContentPart = {
  type: "image";
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  alt?: string;
  width?: number;
  height?: number;
};

export type FileContentPart = {
  type: "file";
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
};

/** 顺序即展示顺序；新增类型时旧客户端可以安全忽略未知块。 */
export type AgentContentPart =
  TextContentPart | JsonContentPart | ImageContentPart | FileContentPart;

export function textContentParts(content: string): AgentContentPart[] {
  return content ? [{ type: "text", text: content }] : [];
}
