import { Module } from "@nestjs/common";

import { ModelProvidersModule } from "../model-providers/model-providers.module";
import { AgentRunsModule } from "../agent_runs/agent-runs.module";
import { RetrievalModule } from "../retrieval/retrieval.module";
import { ToolsModule } from "../tools/tools.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { ConditionNodeExecutor } from "./executors/condition.executor";
import { EndNodeExecutor } from "./executors/end.executor";
import { LlmNodeExecutor } from "./executors/llm.executor";
import { RetrievalNodeExecutor } from "./executors/retrieval.executor";
import { StartNodeExecutor } from "./executors/start.executor";
import { TemplateNodeExecutor } from "./executors/template.executor";
import { ToolNodeExecutor } from "./executors/tool.executor";
import { WorkflowExpressionResolver } from "./expression-resolver";
import { WorkflowNodeExecutorRegistry } from "./node-executor.registry";
import { WorkflowRuntimeService } from "./workflow-runtime.service";
import { WorkflowAppsController } from "./workflow-apps.controller";
import { WorkflowAppRunsService } from "./workflow-app-runs.service";

@Module({
  imports: [AgentRunsModule, WorkflowsModule, ModelProvidersModule, RetrievalModule, ToolsModule],
  controllers: [WorkflowAppsController],
  providers: [
    WorkflowExpressionResolver,
    WorkflowAppRunsService,
    StartNodeExecutor,
    TemplateNodeExecutor,
    ConditionNodeExecutor,
    EndNodeExecutor,
    LlmNodeExecutor,
    RetrievalNodeExecutor,
    ToolNodeExecutor,
    {
      provide: WorkflowNodeExecutorRegistry,
      inject: [
        StartNodeExecutor,
        TemplateNodeExecutor,
        ConditionNodeExecutor,
        EndNodeExecutor,
        LlmNodeExecutor,
        RetrievalNodeExecutor,
        ToolNodeExecutor
      ],
      // 注册顺序不参与执行语义；Registry 会按 type 建索引并拒绝重复实现。
      useFactory: (
        start: StartNodeExecutor,
        template: TemplateNodeExecutor,
        condition: ConditionNodeExecutor,
        end: EndNodeExecutor,
        llm: LlmNodeExecutor,
        retrieval: RetrievalNodeExecutor,
        tool: ToolNodeExecutor
      ) => new WorkflowNodeExecutorRegistry([start, template, condition, end, llm, retrieval, tool])
    },
    WorkflowRuntimeService
  ],
  exports: [WorkflowRuntimeService, WorkflowNodeExecutorRegistry]
})
export class WorkflowRuntimeModule {}
