import { Injectable } from '@nestjs/common';

import { ToolListItem } from './dto/tool.dto';

const builtinTools: ToolListItem[] = [
  {
    id: 'http_request',
    name: 'HTTP 请求',
    description: '向指定 HTTP 接口发送请求，适合调用内部系统或外部 API。',
    enabled: true,
  },
  {
    id: 'calculator',
    name: '计算器',
    description: '执行基础数学计算，适合处理确定性的数字运算。',
    enabled: true,
  },
  {
    id: 'current_time',
    name: '当前时间',
    description: '获取当前时间，适合回答和时间相关的问题。',
    enabled: true,
  },
];

@Injectable()
export class ToolsService {
  listTools(): ToolListItem[] {
    return builtinTools.filter((tool) => tool.enabled);
  }
}
