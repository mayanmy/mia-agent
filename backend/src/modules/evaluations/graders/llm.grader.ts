import { Injectable } from "@nestjs/common";

import { ModelProvidersService } from "../../model-providers/model-providers.service";

export type JudgeMetric = {
  score: number;
  passed: boolean;
  reason: string;
  evidence: string[];
  failureType: string | null;
};

export type JudgeResult = {
  metrics: {
    correctness: JudgeMetric;
    faithfulness: JudgeMetric;
    relevance: JudgeMetric;
  } | null;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  warning: string | null;
};

type JudgeInput = {
  modelConfigId: string;
  question: string;
  expectedAnswer: string | null;
  answerable: boolean;
  actualAnswer: string;
  contexts: Array<{ documentName: string; content: string }>;
  signal: AbortSignal;
};

@Injectable()
export class LlmEvaluationGrader {
  static readonly promptVersion = "rag-judge-v1";

  constructor(private readonly modelProvidersService: ModelProvidersService) {}

  async grade(input: JudgeInput): Promise<JudgeResult> {
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let hasUsage = false;
    let lastError = "裁判模型未返回可解析的 JSON";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.modelProvidersService.createChatCompletion({
          modelConfigId: input.modelConfigId,
          messages: [
            { role: "system", content: this.systemPrompt() },
            { role: "user", content: this.userPrompt(input, attempt === 1) }
          ],
          temperature: 0,
          maxTokens: 1200,
          purpose: "evaluation_grader",
          signal: input.signal
        });
        if (response.usage) {
          hasUsage = true;
          usage.promptTokens += response.usage.promptTokens ?? 0;
          usage.completionTokens += response.usage.completionTokens ?? 0;
          usage.totalTokens += response.usage.totalTokens ?? 0;
        }
        const parsed = this.parse(response.content);
        if (parsed) return { metrics: parsed, usage: hasUsage ? usage : null, warning: null };
      } catch (error) {
        if (input.signal.aborted) throw error;
        lastError = error instanceof Error ? error.message : lastError;
      }
    }
    // Judge 失败不能把已成功生成的评估答案标为失败，指标以 null 明确表示缺失。
    return { metrics: null, usage: hasUsage ? usage : null, warning: lastError.slice(0, 500) };
  }

  private systemPrompt(): string {
    return (
      `你是严格、可复现的 RAG 回答评估器。只输出 JSON，不要 Markdown。\n` +
      `分别评估 correctness（相对参考答案的正确与完整）、faithfulness（仅依据检索上下文，是否存在无依据陈述）、relevance（是否直接回答问题）。\n` +
      `每项格式必须是 {"score":0到1,"passed":布尔值,"reason":"简短中文说明","evidence":["证据"],"failure_type":字符串或null}。\n` +
      `顶层格式为 {"correctness":{...},"faithfulness":{...},"relevance":{...}}。passed 建议阈值为 0.7。没有参考答案时 correctness 仍结合问题与可回答性判断，但需在 reason 中说明。`
    );
  }

  private userPrompt(input: JudgeInput, repair: boolean): string {
    const context = input.contexts.length
      ? input.contexts
          .map((item, index) => `[${index + 1}] ${item.documentName}\n${item.content}`)
          .join("\n\n")
      : "（无检索上下文）";
    return (
      `${repair ? "上一次输出无法解析，请严格按指定 JSON 格式重新评估。\n\n" : ""}` +
      `问题：${input.question}\n\n参考答案：${input.expectedAnswer || "（未提供）"}\n\n` +
      `标注可回答：${input.answerable ? "是" : "否"}\n\n实际答案：${input.actualAnswer}\n\n检索上下文：\n${context}`
    );
  }

  private parse(content: string): JudgeResult["metrics"] {
    try {
      const cleaned = content
        .trim()
        .replace(/^```(?:json)?\s*/iu, "")
        .replace(/\s*```$/u, "");
      const value = JSON.parse(cleaned) as Record<string, unknown>;
      const correctness = this.metric(value.correctness);
      const faithfulness = this.metric(value.faithfulness);
      const relevance = this.metric(value.relevance);
      return correctness && faithfulness && relevance
        ? { correctness, faithfulness, relevance }
        : null;
    } catch {
      return null;
    }
  }

  private metric(value: unknown): JudgeMetric | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (
      typeof row.score !== "number" ||
      !Number.isFinite(row.score) ||
      row.score < 0 ||
      row.score > 1
    )
      return null;
    if (typeof row.passed !== "boolean" || typeof row.reason !== "string") return null;
    return {
      score: row.score,
      passed: row.passed,
      reason: row.reason.slice(0, 1000),
      evidence: Array.isArray(row.evidence)
        ? row.evidence.filter((item): item is string => typeof item === "string").slice(0, 10)
        : [],
      failureType: typeof row.failure_type === "string" ? row.failure_type.slice(0, 100) : null
    };
  }
}
