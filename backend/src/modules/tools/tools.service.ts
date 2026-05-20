import { Injectable } from '@nestjs/common';

import { ToolListItem } from './dto/tool.dto';
import { listEnabledBuiltinTools } from './registry';

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
}
