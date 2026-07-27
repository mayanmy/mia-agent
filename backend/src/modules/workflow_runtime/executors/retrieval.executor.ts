import { Injectable } from "@nestjs/common";

import { RetrievalService } from "../../retrieval/retrieval.service";
import {
  NodeExecutionResult,
  WorkflowNodeExecutionRequest,
  WorkflowNodeExecutor
} from "../dto/node-execution.dto";
import { WorkflowExpressionResolver } from "../expression-resolver";
import { WorkflowRuntimeError } from "../workflow-runtime.error";

@Injectable()
export class RetrievalNodeExecutor implements WorkflowNodeExecutor {
  readonly type = "retrieval";

  /** Retrieval 节点通过 RetrievalService 使用知识库，不直接访问 Chunk、向量表或 Embedding。 */
  constructor(
    private readonly retrievalService: RetrievalService,
    private readonly expressionResolver: WorkflowExpressionResolver
  ) {}

  /** 输出同时提供完整 chunks 和轻量 sources，方便后续 Prompt 与最终引用分别消费。 */
  async execute(request: WorkflowNodeExecutionRequest): Promise<NodeExecutionResult> {
    const config = this.expressionResolver.resolveConfig(
      request.node.config,
      request.context,
      request.node.id
    );
    const query = this.requireString(config.query, "query", request.node.id);
    const knowledgeBaseIds = this.requireStringArray(
      config.knowledgeBaseIds,
      "knowledgeBaseIds",
      request.node.id
    );
    const topK = this.optionalPositiveInteger(config.topK, "topK", request.node.id);
    const scoreThreshold = this.optionalScore(config.scoreThreshold, request.node.id);

    try {
      const context = await this.retrievalService.retrieveKnowledgeContext({
        query,
        knowledgeBaseIds,
        topK,
        scoreThreshold,
        signal: request.signal
      });
      return {
        status: "completed",
        output: {
          query: context.query,
          chunks: context.sources.map((source) => ({ ...source })),
          sources: context.sources.map((source) => ({
            knowledgeBaseId: source.knowledgeBaseId,
            documentId: source.documentId,
            documentName: source.documentName,
            chunkId: source.chunkId,
            chunkIndex: source.chunkIndex,
            score: source.score
          })),
          elapsedMs: context.elapsedMs
        }
      };
    } catch (error) {
      if (request.signal?.aborted) {
        throw new WorkflowRuntimeError("workflow_canceled", "Workflow 已取消", request.node.id);
      }
      throw new WorkflowRuntimeError(
        "workflow_retrieval_failed",
        error instanceof Error && error.message ? error.message : "知识检索失败",
        request.node.id,
        true
      );
    }
  }

  /** query 不能为空，空查询应由画布修正而不是静默返回空检索。 */
  private requireString(value: unknown, field: string, nodeId: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw this.invalid(nodeId, `${field} 必须是非空字符串`);
    }
    return value;
  }

  /** 知识库 ID 数组在执行层再次防御历史坏版本。 */
  private requireStringArray(value: unknown, field: string, nodeId: string): string[] {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.some((item) => typeof item !== "string" || !item.trim())
    ) {
      throw this.invalid(nodeId, `${field} 必须是非空字符串数组`);
    }
    return value.map((item) => String(item).trim());
  }

  /** topK 必须为正整数，实际最大值继续由 RetrievalService 统一限制。 */
  private optionalPositiveInteger(
    value: unknown,
    field: string,
    nodeId: string
  ): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || Number(value) < 1) {
      throw this.invalid(nodeId, `${field} 必须是正整数`);
    }
    return Number(value);
  }

  /** scoreThreshold 使用 0-1 区间，保持与管理端相关度配置一致。 */
  private optionalScore(value: unknown, nodeId: string): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw this.invalid(nodeId, "scoreThreshold 必须在 0-1 之间");
    }
    return value;
  }

  /** Retrieval 配置错误是不可重试的输出协议问题。 */
  private invalid(nodeId: string, message: string): WorkflowRuntimeError {
    return new WorkflowRuntimeError("workflow_output_invalid", message, nodeId);
  }
}
