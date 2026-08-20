import type { ChatMessage } from "./api";
import type { ChatUiMessage } from "./types";

export const MAX_TRANSPORT_HISTORY_BYTES = 256 * 1024;
const MAX_HISTORY_TURNS = 20;

export type BuildTransportHistoryOptions = {
  maxTurns: number;
  maxTotalBytes?: number;
};

/**
 * 从 UI 全量记录中只选择最近的 user 主导轮次，避免长会话在每次 SSE 请求中重复上传。
 * 字节预算按完整轮次从新到旧使用，不截断正文，也不携带附件和过程展示字段。
 */
export function buildTransportHistory(
  messages: ChatUiMessage[],
  options: BuildTransportHistoryOptions
): ChatMessage[] {
  const maxTurns = normalizeMaxTurns(options.maxTurns);

  if (maxTurns === 0) {
    return [];
  }

  const turns: ChatMessage[][] = [];

  for (const message of messages) {
    const content = message.content.trim();

    if (!content) {
      continue;
    }

    const historyMessage: ChatMessage = { role: message.role, content };

    if (message.role === "user") {
      turns.push([historyMessage]);
      continue;
    }

    const latestTurn = turns[turns.length - 1];

    if (latestTurn && latestTurn.length === 1) {
      latestTurn.push(historyMessage);
    }
  }

  const selectedTurns = turns.slice(-maxTurns);
  const maxTotalBytes = Math.max(0, options.maxTotalBytes ?? MAX_TRANSPORT_HISTORY_BYTES);
  const encoder = new TextEncoder();
  const acceptedTurns: ChatMessage[][] = [];
  let acceptedBytes = 0;

  for (let index = selectedTurns.length - 1; index >= 0; index -= 1) {
    const turn = selectedTurns[index];
    const turnBytes = turn.reduce(
      (total, message) => total + encoder.encode(message.content).byteLength,
      0
    );

    if (acceptedBytes + turnBytes > maxTotalBytes) {
      break;
    }

    acceptedTurns.unshift(turn);
    acceptedBytes += turnBytes;
  }

  return acceptedTurns.flat();
}

function normalizeMaxTurns(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(MAX_HISTORY_TURNS, Math.max(0, Math.trunc(value)));
}
