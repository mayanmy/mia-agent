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
        '工具不存在或已停用',
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
    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      error.name === 'AbortError'
    ) {
      return 'canceled';
    }

    const message = this.getRawErrorMessage(error);

    if (
      message.includes('is required') ||
      message.includes('is invalid') ||
      message.includes('must be') ||
      message.includes('can only contain') ||
      message.includes('not allowed')
    ) {
      return 'invalid_tool_input';
    }

    return 'tool_execution_failed';
  }

  private getErrorMessage(error: unknown): string {
    const message = this.getRawErrorMessage(error);

    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      error.name === 'AbortError'
    ) {
      return '工具调用超时或已取消';
    }

    if (message === 'url is required') {
      return 'HTTP 请求参数错误：url 不能为空';
    }

    if (message === 'url is invalid') {
      return 'HTTP 请求参数错误：url 格式不正确';
    }

    if (message === 'url must use http or https') {
      return 'HTTP 请求参数错误：只支持 http 或 https 地址';
    }

    if (message === 'url hostname is not allowed') {
      return 'HTTP 请求被安全策略拦截：目标地址不允许访问';
    }

    if (message === 'method must be GET or POST') {
      return 'HTTP 请求参数错误：method 只支持 GET 或 POST';
    }

    if (message === 'body must be an object') {
      return 'HTTP 请求参数错误：body 必须是对象';
    }

    if (message === 'timeoutMs must be a number') {
      return 'HTTP 请求参数错误：timeoutMs 必须是数字';
    }

    if (message === 'timeoutMs must be between 1 and 30000') {
      return 'HTTP 请求参数错误：timeoutMs 必须在 1 到 30000 毫秒之间';
    }

    if (message === 'response body is too large') {
      return 'HTTP 响应过大，已停止读取';
    }

    if (message === 'division by zero is not allowed') {
      return '计算器参数错误：不允许除以 0';
    }

    if (message.includes('operands')) {
      return `计算器参数错误：${message}`;
    }

    if (message.includes('operation')) {
      return `计算器参数错误：${message}`;
    }

    return message || '工具调用失败';
  }

  private getRawErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return '';
  }
}
