import { Module } from "@nestjs/common";

import { AgentRunsModule } from "../agent_runs/agent-runs.module";
import { AgentsModule } from "../agents/agents.module";
import { ModelProvidersModule } from "../model-providers/model-providers.module";
import { RetrievalModule } from "../retrieval/retrieval.module";
import { ToolsModule } from "../tools/tools.module";
import { AgentRuntimeService } from "./agent-runtime.service";
import { AgentPromptBuilder } from "./prompt-builder";

/**
 * Agent Runtime 的组合边界。
 *
 * 当前先导出无状态 Prompt Builder；后续 Runtime 执行器、Hooks 和 Policy 都从此模块
 * 对外暴露，Chat 只依赖该模块，不再直接持有模型、检索和工具实现。
 */
@Module({
  imports: [AgentRunsModule, AgentsModule, ModelProvidersModule, RetrievalModule, ToolsModule],
  providers: [AgentRuntimeService, AgentPromptBuilder],
  exports: [AgentRuntimeService, AgentPromptBuilder]
})
export class AgentRuntimeModule {}
