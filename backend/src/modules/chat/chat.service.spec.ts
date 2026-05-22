import * as assert from 'node:assert/strict';
import { ModelProviderType } from '@prisma/client';

import { ChatService } from './chat.service';
import { ChatStreamEvent } from './dto/chat.dto';
import { ChatCompletionRequest, ChatStreamChunk } from '../model-providers/dto/llm.dto';

async function* chunks(items: ChatStreamChunk[]): AsyncIterable<ChatStreamChunk> {
  for (const item of items) {
    yield item;
  }
}

export const tests = [
  {
    name: 'ChatService streams tool_call, tool_result, then final answer',
    run: async () => {
  const modelRequests: ChatCompletionRequest[] = [];
  const agentsService = {
    getAgentRuntimeConfig: async () => ({
      agentId: 'agent-id',
      name: 'Tool Agent',
      systemPrompt: 'Use tools when useful.',
      modelConfigId: 'model-config-id',
      modelName: 'gpt-compatible',
      providerId: 'provider-id',
      providerType: ModelProviderType.OPENAI_COMPATIBLE,
      baseUrl: 'https://example.com/v1',
      temperature: 0.7,
      maxTokens: null,
      timeoutSeconds: 120,
      historyTurns: 6,
      generationParams: null,
      knowledgeBaseIds: [],
      toolIds: ['calculator'],
    }),
  };
  const modelProvidersService = {
    streamChatCompletion: (request: ChatCompletionRequest) => {
      modelRequests.push(request);

      if (modelRequests.length === 1) {
        return chunks([
          {
            type: 'tool_call',
            toolCall: {
              id: 'call-1',
              name: 'calculator',
              arguments: {
                operation: 'add',
                operands: [2, 3],
              },
              rawArguments: '{"operation":"add","operands":[2,3]}',
            },
          },
          {
            type: 'done',
          },
        ]);
      }

      return chunks([
        {
          type: 'token',
          content: '结果是 5。',
        },
        {
          type: 'done',
        },
      ]);
    },
  };
  const toolsService = {
    getToolDefinitions: () => [
      {
        id: 'calculator',
        name: '计算器',
        description: '执行基础数学计算。',
        enabled: true,
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    ],
    executeTool: async () => ({
      toolId: 'calculator',
      ok: true,
      output: {
        operation: 'add',
        operands: [2, 3],
        result: 5,
      },
      elapsedMs: 1,
    }),
  };
  const service = new ChatService(
    agentsService as never,
    modelProvidersService as never,
    toolsService as never,
  );
  const events: ChatStreamEvent[] = [];

  for await (const event of service.streamCompletion({
    agentId: 'agent-id',
    message: '2 + 3 是多少？',
    history: [],
    images: [],
    files: [],
  })) {
    events.push(event);
  }

  assert.deepEqual(
    events.map((event) => event.type),
    ['message_start', 'tool_call', 'tool_result', 'token', 'message_end'],
  );
  assert.deepEqual(events[1].data, {
    id: 'call-1',
    name: 'calculator',
    arguments: {
      operation: 'add',
      operands: [2, 3],
    },
  });
  assert.equal(events[2].data.ok, true);
  assert.equal(events[3].data.content, '结果是 5。');
  assert.equal(modelRequests.length, 2);
  assert.equal(modelRequests[0].tools?.[0]?.name, 'calculator');
  assert.ok(modelRequests[1].messages.some((message) => message.role === 'tool'));
    },
  },
];
