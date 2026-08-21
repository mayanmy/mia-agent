import { HttpStatus } from "@nestjs/common";

import { AppError, ErrorCodes } from "../../core/errors";
import { AgentRuntimeHistoryMessage } from "./dto/agent-run.dto";

export const MAX_HISTORY_TURNS = 20;
export const MAX_HISTORY_MESSAGE_BYTES = 32 * 1024;
export const MAX_TRANSPORT_HISTORY_BYTES = 256 * 1024;
export const MAX_MODEL_HISTORY_BYTES = 64 * 1024;

export type HistoryPolicyViolationSource = "client" | "runtime";

export type HistoryDropReason = "orphan_assistant" | "turn_limit" | "byte_limit";

export type HistorySanitizeResult = {
  messages: AgentRuntimeHistoryMessage[];
  receivedMessages: number;
  acceptedMessages: number;
  droppedMessages: number;
  receivedBytes: number;
  acceptedBytes: number;
  reasons: Partial<Record<HistoryDropReason, number>>;
};

export type HistoryPolicyOptions = {
  maxTurns: number;
  maxTotalBytes: number;
  maxMessageBytes?: number;
  violationSource: HistoryPolicyViolationSource;
};

/**
 * 将任意入口的历史统一收敛为最近若干个 user 主导的轮次。
 * 整轮从后向前纳入预算，避免截断文本或留下孤立 assistant 而改变上下文语义。
 */
export function sanitizeHistory(
  input: unknown,
  options: HistoryPolicyOptions
): HistorySanitizeResult {
  if (input === undefined || input === null) {
    return emptyResult();
  }

  if (!Array.isArray(input)) {
    throwHistoryViolation("history must be an array", options.violationSource);
  }

  const maxTurns = normalizeMaxTurns(options.maxTurns);
  const maxMessageBytes = options.maxMessageBytes ?? MAX_HISTORY_MESSAGE_BYTES;
  const maxTotalBytes = Math.max(0, options.maxTotalBytes);
  const normalized: AgentRuntimeHistoryMessage[] = [];
  let receivedBytes = 0;

  for (const item of input) {
    if (!item || typeof item !== "object") {
      throwHistoryViolation("history message is invalid", options.violationSource);
    }

    const role = Reflect.get(item, "role");
    const rawContent = Reflect.get(item, "content");

    if (role !== "user" && role !== "assistant") {
      throwHistoryViolation("history role is invalid", options.violationSource);
    }

    if (typeof rawContent !== "string" || !rawContent.trim()) {
      throwHistoryViolation("history content is invalid", options.violationSource);
    }

    const content = rawContent.trim();
    const contentBytes = Buffer.byteLength(content, "utf8");

    if (contentBytes > maxMessageBytes) {
      throwHistoryMessageTooLarge(options.violationSource);
    }

    receivedBytes += contentBytes;
    normalized.push({ role, content });
  }

  const reasons: HistorySanitizeResult["reasons"] = {};
  const turns: AgentRuntimeHistoryMessage[][] = [];

  for (const message of normalized) {
    if (message.role === "user") {
      turns.push([message]);
      continue;
    }

    const latestTurn = turns.at(-1);

    if (!latestTurn || latestTurn.length > 1) {
      incrementReason(reasons, "orphan_assistant", 1);
      continue;
    }

    latestTurn.push(message);
  }

  const selectedTurns = maxTurns > 0 ? turns.slice(-maxTurns) : [];
  const droppedByTurns = turns
    .slice(0, Math.max(0, turns.length - selectedTurns.length))
    .reduce((total, turn) => total + turn.length, 0);
  incrementReason(reasons, "turn_limit", droppedByTurns);

  const acceptedTurns: AgentRuntimeHistoryMessage[][] = [];
  let acceptedBytes = 0;

  for (let index = selectedTurns.length - 1; index >= 0; index -= 1) {
    const turn = selectedTurns[index];
    const turnBytes = turn.reduce(
      (total, message) => total + Buffer.byteLength(message.content, "utf8"),
      0
    );

    if (acceptedBytes + turnBytes > maxTotalBytes) {
      const droppedByBytes = selectedTurns
        .slice(0, index + 1)
        .reduce((total, item) => total + item.length, 0);
      incrementReason(reasons, "byte_limit", droppedByBytes);
      break;
    }

    acceptedTurns.unshift(turn);
    acceptedBytes += turnBytes;
  }

  const messages = acceptedTurns.flat();

  return {
    messages,
    receivedMessages: input.length,
    acceptedMessages: messages.length,
    droppedMessages: input.length - messages.length,
    receivedBytes,
    acceptedBytes,
    reasons
  };
}

function normalizeMaxTurns(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(MAX_HISTORY_TURNS, Math.max(0, Math.trunc(value)));
}

function emptyResult(): HistorySanitizeResult {
  return {
    messages: [],
    receivedMessages: 0,
    acceptedMessages: 0,
    droppedMessages: 0,
    receivedBytes: 0,
    acceptedBytes: 0,
    reasons: {}
  };
}

function incrementReason(
  reasons: HistorySanitizeResult["reasons"],
  reason: HistoryDropReason,
  count: number
): void {
  if (count > 0) {
    reasons[reason] = (reasons[reason] ?? 0) + count;
  }
}

function throwHistoryMessageTooLarge(source: HistoryPolicyViolationSource): never {
  if (source === "runtime") {
    throw new AppError(
      ErrorCodes.chat.historyPolicyViolation,
      "runtime history message exceeds the model policy",
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  throw new AppError(
    ErrorCodes.chat.historyMessageTooLarge,
    `history message must not exceed ${MAX_HISTORY_MESSAGE_BYTES} bytes`,
    HttpStatus.BAD_REQUEST
  );
}

function throwHistoryViolation(message: string, source: HistoryPolicyViolationSource): never {
  if (source === "runtime") {
    throw new AppError(
      ErrorCodes.chat.historyPolicyViolation,
      `runtime ${message}`,
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  throw new AppError(ErrorCodes.chat.historyInvalid, message, HttpStatus.BAD_REQUEST);
}
