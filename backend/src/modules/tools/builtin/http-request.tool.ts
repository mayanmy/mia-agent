import type { BuiltinTool, ToolExecutionContext } from '../registry';
import { ToolJsonValue } from '../dto/tool.dto';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const allowedMethods = new Set(['GET', 'POST']);
const blockedHostnames = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
]);

export const httpRequestTool: BuiltinTool = {
  id: 'http_request',
  name: 'HTTP 请求',
  description: '向指定 HTTP 接口发送请求，适合调用内部系统或外部 API。',
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要请求的 HTTP 或 HTTPS 地址。',
      },
      method: {
        type: 'string',
        enum: [...allowedMethods],
        description: '请求方法，仅支持 GET 或 POST。',
      },
      body: {
        type: 'object',
        description: 'POST 请求的 JSON body。',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  async execute(input, context) {
    const url = normalizeUrl(input.url);
    const method = normalizeMethod(input.method);
    const body = normalizeBody(input.body);
    const startedAt = Date.now();
    const response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      body: method === 'POST' && body !== undefined ? JSON.stringify(body) : undefined,
      signal: buildTimeoutSignal(context),
    });
    const text = await readLimitedResponse(response);

    return {
      url,
      method,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type') ?? '',
      elapsedMs: Date.now() - startedAt,
      body: parseResponseBody(text),
    };
  },
};

function normalizeUrl(value: ToolJsonValue): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('url is required');
  }

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('url is invalid');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('url must use http or https');
  }

  if (blockedHostnames.has(url.hostname.toLowerCase()) || isPrivateIpv4(url.hostname)) {
    throw new Error('url hostname is not allowed');
  }

  return url.toString();
}

function normalizeMethod(value: ToolJsonValue): 'GET' | 'POST' {
  if (value === undefined || value === null || value === '') {
    return 'GET';
  }

  if (typeof value !== 'string') {
    throw new Error('method must be a string');
  }

  const method = value.toUpperCase();

  if (!allowedMethods.has(method)) {
    throw new Error('method must be GET or POST');
  }

  return method as 'GET' | 'POST';
}

function normalizeBody(value: ToolJsonValue): ToolJsonValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value) || typeof value !== 'object') {
    throw new Error('body must be an object');
  }

  return value;
}

function buildTimeoutSignal(context: ToolExecutionContext): AbortSignal {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  if (context.signal?.aborted) {
    clearTimeout(timeout);
    controller.abort();
    return controller.signal;
  }

  context.signal?.addEventListener(
    'abort',
    () => {
      clearTimeout(timeout);
      controller.abort();
    },
    { once: true },
  );

  controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });

  return controller.signal;
}

async function readLimitedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();

  if (!reader) {
    return '';
  }

  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    size += value.length;

    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('response body is too large');
    }

    chunks.push(value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

function parseResponseBody(text: string): ToolJsonValue {
  if (!text) {
    return '';
  }

  try {
    return JSON.parse(text) as ToolJsonValue;
  } catch {
    return text;
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');

  if (parts.length !== 4) {
    return false;
  }

  const numbers = parts.map((part) => Number(part));

  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = numbers;

  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}
