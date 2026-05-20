import { Injectable } from '@nestjs/common';

import {
  ToolDefinition,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolJsonValue,
  ToolListItem,
} from './dto/tool.dto';
import {
  getBuiltinTool,
  getBuiltinToolDefinitions,
  listEnabledBuiltinTools,
} from './registry';

@Injectable()
export class ToolsService {
  listTools(): ToolListItem[] {
    return listEnabledBuiltinTools().map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      enabled: tool.enabled,
    }));
  }

  getToolDefinitions(toolIds: string[]): ToolDefinition[] {
    const normalizedToolIds = this.normalizeToolIds(toolIds);
    return getBuiltinToolDefinitions(normalizedToolIds);
  }

  async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const startedAt = Date.now();
    const toolId = this.normalizeToolId(request.toolId);
    const tool = getBuiltinTool(toolId);

    if (!tool || !tool.enabled) {
      return this.toFailureResult(
        toolId,
        'tool_not_found',
        'tool is not found or disabled',
        startedAt,
      );
    }

    try {
      const output = await tool.execute(this.normalizeInput(request.input), {
        requestId: request.requestId,
        userId: request.userId,
        agentId: request.agentId,
        signal: request.signal,
      });

      return {
        toolId,
        ok: true,
        output,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      return this.toFailureResult(
        toolId,
        this.getErrorType(error),
        this.getErrorMessage(error),
        startedAt,
      );
    }
  }

  private normalizeToolIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return [
      ...new Set(
        value
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0),
      ),
    ];
  }

  private normalizeToolId(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeInput(value: unknown): Record<string, ToolJsonValue> {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return {};
    }

    return value as Record<string, ToolJsonValue>;
  }

  private toFailureResult(
    toolId: string,
    errorType: string,
    errorMessage: string,
    startedAt: number,
  ): ToolExecutionResult {
    return {
      toolId,
      ok: false,
      errorType,
      errorMessage,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private getErrorType(error: unknown): string {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return 'canceled';
    }

    return 'tool_execution_failed';
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return 'tool execution failed';
  }
}
