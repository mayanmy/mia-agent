import * as assert from 'node:assert/strict';

import { ToolsService } from './tools.service';

export const tests = [
  {
    name: 'ToolsService lists enabled builtin tools',
    run: () => {
  const service = new ToolsService();
  const tools = service.listTools();
  const toolIds = tools.map((tool) => tool.id);

  assert.deepEqual(toolIds, ['http_request', 'calculator', 'current_time']);
  assert.ok(tools.every((tool) => tool.enabled));
    },
  },

  {
    name: 'ToolsService executes calculator successfully',
    run: async () => {
  const service = new ToolsService();
  const result = await service.executeTool({
    toolId: 'calculator',
    input: {
      operation: 'add',
      operands: [1, 2, 3],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.output, {
    operation: 'add',
    operands: [1, 2, 3],
    result: 6,
  });
    },
  },

  {
    name: 'ToolsService wraps calculator failures',
    run: async () => {
  const service = new ToolsService();
  const result = await service.executeTool({
    toolId: 'calculator',
    input: {
      operation: 'divide',
      operands: [10, 0],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorType, 'tool_execution_failed');
  assert.equal(result.errorMessage, 'division by zero is not allowed');
    },
  },

  {
    name: 'ToolsService blocks http_request to local addresses',
    run: async () => {
  const service = new ToolsService();
  const result = await service.executeTool({
    toolId: 'http_request',
    input: {
      url: 'http://127.0.0.1:3000/private',
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorType, 'tool_execution_failed');
  assert.equal(result.errorMessage, 'url hostname is not allowed');
    },
  },

  {
    name: 'ToolsService times out http_request',
    run: async () => {
  const service = new ToolsService();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          reject(error);
        },
        { once: true },
      );
    });
  }) as typeof fetch;

  try {
    const result = await service.executeTool({
      toolId: 'http_request',
      input: {
        url: 'https://example.com/slow',
        timeoutMs: 1,
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.errorType, 'canceled');
  } finally {
    globalThis.fetch = originalFetch;
  }
    },
  },
];
