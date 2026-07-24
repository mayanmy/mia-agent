import { Module } from "@nestjs/common";

import { WorkflowsModule } from "../workflows/workflows.module";
import { ConditionNodeExecutor } from "./executors/condition.executor";
import { EndNodeExecutor } from "./executors/end.executor";
import { StartNodeExecutor } from "./executors/start.executor";
import { TemplateNodeExecutor } from "./executors/template.executor";
import { WorkflowExpressionResolver } from "./expression-resolver";
import { WorkflowNodeExecutorRegistry } from "./node-executor.registry";
import { WorkflowRuntimeService } from "./workflow-runtime.service";

@Module({
  imports: [WorkflowsModule],
  providers: [
    WorkflowExpressionResolver,
    StartNodeExecutor,
    TemplateNodeExecutor,
    ConditionNodeExecutor,
    EndNodeExecutor,
    {
      provide: WorkflowNodeExecutorRegistry,
      inject: [StartNodeExecutor, TemplateNodeExecutor, ConditionNodeExecutor, EndNodeExecutor],
      // 注册顺序不参与执行语义；Registry 会按 type 建索引并拒绝重复实现。
      useFactory: (
        start: StartNodeExecutor,
        template: TemplateNodeExecutor,
        condition: ConditionNodeExecutor,
        end: EndNodeExecutor
      ) => new WorkflowNodeExecutorRegistry([start, template, condition, end])
    },
    WorkflowRuntimeService
  ],
  exports: [WorkflowRuntimeService, WorkflowNodeExecutorRegistry]
})
export class WorkflowRuntimeModule {}
