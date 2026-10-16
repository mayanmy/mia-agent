import { Injectable } from "@nestjs/common";

import { LLMToolDefinition } from "../model-providers/dto/llm.dto";
import { RetrievalContext } from "../retrieval/dto/retrieval.dto";

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const RETRIEVAL_SOURCE_PREVIEW_LENGTH = 500;

@Injectable()
export class AgentPromptBuilder {
  /**
   * 组装一次 Agent Run 的系统提示词。
   *
   * Prompt 构建属于 Runtime，而不是 Chat 协议层：同一套规则后续还要供 API、Job、
   * Subagent 等入口复用，不能随着 SSE 或会话接口各自演化。
   */
  buildSystemPrompt(request: {
    systemPrompt: string;
    query: string;
    skillPrompt?: string;
    tools: LLMToolDefinition[];
    retrievalContext: RetrievalContext | null;
  }): string {
    const renderedPrompt = this.renderQueryPlaceholder(request.systemPrompt, request.query);
    const sections = [renderedPrompt];

    // Agent 可显式控制问题插入位置；未声明占位符时仍补充问题，便于知识和工具规则引用。
    if (!this.hasQueryPlaceholder(request.systemPrompt)) {
      sections.push("", "当前用户问题：", request.query);
    }

    if (request.skillPrompt?.trim()) {
      sections.push("", request.skillPrompt.trim());
    }

    if (request.tools.length > 0) {
      const toolDescriptions = request.tools
        .map(
          (tool) =>
            `- ${tool.name}: ${tool.description}; parameters=${JSON.stringify(tool.parameters)}`
        )
        .join("\n");

      sections.push(
        "",
        "工具调用规则：",
        "当用户问题需要实时信息、精确计算、当前日期时间或外部查询时，必须使用可用工具，不要猜测。",
        `如果需要获取当前时间且用户未指定时区，使用 ${DEFAULT_TIMEZONE}。`,
        "如果模型接口不支持原生工具调用，则只输出下面 JSON，不要输出解释文字：",
        "```json",
        '{"name":"tool_id","arguments":{}}',
        "```",
        "可用工具：",
        toolDescriptions,
        "拿到工具结果后，再基于工具结果用自然语言回答用户。",
        "如果工具结果包含 errorType 或 errorMessage，只能说明工具或 Workflow 执行失败；不得把错误文案推断为被查询业务对象的真实状态。"
      );
    }

    if (request.retrievalContext && request.retrievalContext.sources.length > 0) {
      sections.push("", "回答时优先使用随后的知识库来源；如果资料不足，明确说明缺少依据。");
    }

    return sections.join("\n");
  }

  /** 将 Prompt 中所有 query 占位符替换为本次输入，并兼容空格和大小写。 */
  private renderQueryPlaceholder(prompt: string, query: string): string {
    return prompt.replace(/\{\{\s*query\s*\}\}/giu, query);
  }

  /** 判断原始 Prompt 是否已经声明 query，避免带空格的占位符导致问题重复注入。 */
  private hasQueryPlaceholder(prompt: string): boolean {
    return /\{\{\s*query\s*\}\}/iu.test(prompt);
  }

  /**
   * 生成可安全放入事件和 Trace 的检索摘要。
   * 正文仍保留在模型上下文中，预览限制长度以免 SSE 和日志被大段文档撑高。
   */
  formatRetrievalSourcePreview(content: string): string {
    const normalized = content.replace(/\s+/gu, " ").trim();

    if (normalized.length <= RETRIEVAL_SOURCE_PREVIEW_LENGTH) {
      return normalized;
    }

    return `${normalized.slice(0, RETRIEVAL_SOURCE_PREVIEW_LENGTH)}...`;
  }
}
