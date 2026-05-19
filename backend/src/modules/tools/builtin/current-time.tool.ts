import type { BuiltinTool } from '../registry';

export const currentTimeTool: BuiltinTool = {
  id: 'current_time',
  name: '当前时间',
  description: '获取当前时间，适合回答和时间相关的问题。',
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'IANA 时区名称，例如 Asia/Shanghai。为空时使用 UTC。',
      },
    },
    additionalProperties: false,
  },
  async execute(input) {
    const timezone = normalizeTimezone(input.timezone);
    const now = new Date();

    return {
      timezone,
      isoTime: now.toISOString(),
      localTime: new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone: timezone,
      }).format(now),
      unixMs: now.getTime(),
    };
  },
};

function normalizeTimezone(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'UTC';
  }

  if (typeof value !== 'string') {
    throw new Error('timezone must be a string');
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new Error('timezone is invalid');
  }
}
