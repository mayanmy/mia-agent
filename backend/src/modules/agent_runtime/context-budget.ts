import { ChatMessage } from "../model-providers/dto/llm.dto";
import { RetrievalContext } from "../retrieval/dto/retrieval.dto";
import { AgentRuntimeHistoryMessage } from "./dto/agent-run.dto";

export const DEFAULT_MODEL_CONTEXT_TOKENS = 32_768;
export const DEFAULT_OUTPUT_RESERVE_TOKENS = 4_096;
export const MIN_INPUT_BUDGET_TOKENS = 2_048;
export const MAX_CONTEXT_MESSAGE_TOKENS = 8_192;

const MESSAGE_OVERHEAD_TOKENS = 8;
const TRUNCATION_MARKER = "\n...[内容已按上下文预算裁剪]";

export type ContextBudgetRequest = {
  systemPrompt: string;
  history: AgentRuntimeHistoryMessage[];
  retrievalContext: RetrievalContext | null;
  currentMessage: ChatMessage;
  toolMessages?: ChatMessage[];
  contextWindowTokens?: number;
  outputReserveTokens?: number | null;
  maxMessageTokens?: number;
};

export type ContextBudgetReport = {
  budgetTokens: number;
  estimatedTokens: number;
  stageOneDropped: number;
  stageTwoTrimmed: number;
  stageThreeDropped: number;
};

export type ContextBudgetResult = {
  messages: ChatMessage[];
  report: ContextBudgetReport;
};

export function resolveOutputReserveTokens(requested: number | null | undefined): number {
  return Math.min(
    DEFAULT_MODEL_CONTEXT_TOKENS - MIN_INPUT_BUDGET_TOKENS,
    Math.max(0, requested ?? DEFAULT_OUTPUT_RESERVE_TOKENS)
  );
}

/** 工具回合追加消息后重新执行第二、三级裁剪，并保持 assistant tool_calls 与 tool 结果顺序。 */
export function rebudgetModelMessages(
  messages: ChatMessage[],
  options: Pick<ContextBudgetRequest, "contextWindowTokens" | "outputReserveTokens" | "maxMessageTokens">
): ContextBudgetResult {
  const currentIndex = messages.reduce(
    (found, message, index) => message.role === "user" ? index : found,
    -1
  );
  const candidates = messages.map((message, sequence): Candidate => {
    const required = sequence === 0 || sequence === currentIndex;
    const isRag = message.role === "system" && sequence > 0 &&
      typeof message.content === "string" && message.content.startsWith("知识库来源 ");
    const source: Candidate["source"] = sequence === 0
      ? "system"
      : sequence === currentIndex
        ? "current"
        : message.role === "tool" || message.toolCalls?.length
          ? "tool"
          : isRag
            ? "rag"
          : "history";
    const score = isRag && typeof message.content === "string"
      ? Number(message.content.match(/ score=([0-9.]+)/u)?.[1] ?? 0)
      : 1;
    const priority = required ? 100 : source === "tool" ? 70 : source === "rag" ? 55 : 40;
    return candidate(message, source, priority, Number.isFinite(score) ? score : 0, sequence, required);
  });
  return applyBudget(candidates, options);
}

type Candidate = {
  message: ChatMessage;
  source: "system" | "history" | "rag" | "tool" | "current";
  priority: number;
  relevance: number;
  sequence: number;
  required: boolean;
};

/**
 * 统一组装模型上下文。数据库中的原始消息不在这里修改；三级裁剪只作用于本次模型请求副本。
 */
export function buildBudgetedModelContext(request: ContextBudgetRequest): ContextBudgetResult {
  const candidates: Candidate[] = [];
  let sequence = 0;

  candidates.push(candidate({ role: "system", content: request.systemPrompt }, "system", 100, 1, sequence++, true));
  for (const message of request.history) {
    candidates.push(candidate(message, "history", 40, 0, sequence++, false));
  }
  for (const source of request.retrievalContext?.sources ?? []) {
    candidates.push(
      candidate(
        {
          role: "system",
          content: `知识库来源 ${source.documentName} #${source.chunkIndex} score=${source.score.toFixed(4)}\n${source.content}`
        },
        "rag",
        55,
        source.score,
        sequence++,
        false
      )
    );
  }
  for (const message of request.toolMessages ?? []) {
    candidates.push(candidate(message, "tool", 70, 1, sequence++, false));
  }
  candidates.push(candidate(request.currentMessage, "current", 110, 1, sequence++, true));

  return applyBudget(candidates, request);
}

function applyBudget(
  candidates: Candidate[],
  options: Pick<ContextBudgetRequest, "contextWindowTokens" | "outputReserveTokens" | "maxMessageTokens">
): ContextBudgetResult {
  const contextWindow = Math.max(MIN_INPUT_BUDGET_TOKENS, options.contextWindowTokens ?? DEFAULT_MODEL_CONTEXT_TOKENS);
  const outputReserve = resolveOutputReserveTokens(options.outputReserveTokens);
  const budgetTokens = Math.max(MIN_INPUT_BUDGET_TOKENS, contextWindow - outputReserve);
  const maxMessageTokens = Math.max(256, options.maxMessageTokens ?? MAX_CONTEXT_MESSAGE_TOKENS);
  const stageOneDropped = 0;
  let stageTwoTrimmed = 0;
  for (const item of candidates) {
    const limit = item.source === "current" || item.source === "system" ? maxMessageTokens : Math.min(maxMessageTokens, 4_096);
    const trimmed = trimMessage(item.message, limit);
    if (trimmed !== item.message) {
      item.message = trimmed;
      stageTwoTrimmed += 1;
    }
  }

  // 第三级按“是否必需、业务优先级、相关度、时间新近度”统一淘汰，而不是按来源各设孤立预算。
  let estimatedTokens = candidates.reduce((total, item) => total + estimateMessageTokens(item.message), 0);
  let stageThreeDropped = 0;
  const removable = candidates
    .filter((item) => !item.required)
    .sort((left, right) =>
      left.priority - right.priority || left.relevance - right.relevance || left.sequence - right.sequence
    );
  const removed = new Set<Candidate>();
  for (const item of removable) {
    if (estimatedTokens <= budgetTokens) break;
    const group = item.source === "tool" ? findToolInteraction(candidates, item) : [item];
    for (const groupedItem of group) {
      if (removed.has(groupedItem) || groupedItem.required) continue;
      removed.add(groupedItem);
      estimatedTokens -= estimateMessageTokens(groupedItem.message);
      stageThreeDropped += 1;
    }
  }

  const kept = candidates.filter((item) => !removed.has(item));
  if (estimatedTokens > budgetTokens) {
    // 系统提示词和当前输入不可整条删除；极端情况下按剩余共享预算再次收缩。
    const required = kept.filter((item) => item.required);
    const perRequired = Math.max(256, Math.floor(budgetTokens / Math.max(1, required.length)) - MESSAGE_OVERHEAD_TOKENS);
    for (const item of required) item.message = trimMessage(item.message, perRequired);
    estimatedTokens = kept.reduce((total, item) => total + estimateMessageTokens(item.message), 0);
  }

  return {
    messages: kept.sort((left, right) => left.sequence - right.sequence).map((item) => item.message),
    report: { budgetTokens, estimatedTokens, stageOneDropped, stageTwoTrimmed, stageThreeDropped }
  };
}

function findToolInteraction(candidates: Candidate[], selected: Candidate): Candidate[] {
  let start = candidates.indexOf(selected);
  while (start > 0 && candidates[start - 1].source === "tool") start -= 1;
  let end = candidates.indexOf(selected);
  while (end + 1 < candidates.length && candidates[end + 1].source === "tool") end += 1;
  return candidates.slice(start, end + 1);
}

export function estimateTextTokens(value: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const character of value) character.codePointAt(0)! <= 0x7f ? (ascii += 1) : (nonAscii += 1);
  return Math.ceil(ascii / 4) + nonAscii;
}

function candidate(message: ChatMessage, source: Candidate["source"], priority: number, relevance: number, sequence: number, required: boolean): Candidate {
  return { message, source, priority, relevance, sequence, required };
}

function estimateMessageTokens(message: ChatMessage): number {
  const content = typeof message.content === "string"
    ? message.content
    : message.content.map((part) => part.type === "text" ? part.text : "[image]").join("\n");
  return MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(content) + estimateTextTokens(JSON.stringify(message.toolCalls ?? []));
}

function trimMessage(message: ChatMessage, maxTokens: number): ChatMessage {
  if (typeof message.content !== "string" || estimateTextTokens(message.content) <= maxTokens) return message;
  let low = 0;
  let high = message.content.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTextTokens(message.content.slice(0, middle) + TRUNCATION_MARKER) <= maxTokens) low = middle;
    else high = middle - 1;
  }
  return { ...message, content: message.content.slice(0, low).trimEnd() + TRUNCATION_MARKER };
}
