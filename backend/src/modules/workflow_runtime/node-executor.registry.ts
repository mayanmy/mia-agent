import { Injectable } from "@nestjs/common";

import { WorkflowNodeExecutor } from "./dto/node-execution.dto";
import { WorkflowRuntimeError } from "./workflow-runtime.error";

@Injectable()
export class WorkflowNodeExecutorRegistry {
  private readonly executors = new Map<string, WorkflowNodeExecutor>();

  /** 构造阶段拒绝重复类型，避免 provider 顺序决定实际执行器。 */
  constructor(executors: WorkflowNodeExecutor[]) {
    for (const executor of executors) {
      if (this.executors.has(executor.type)) {
        throw new Error(`duplicate Workflow node executor: ${executor.type}`);
      }
      this.executors.set(executor.type, executor);
    }
  }

  /** 未注册类型返回稳定 Runtime 错误；W4 能力节点接入前不会被静默跳过。 */
  get(type: string, nodeId?: string): WorkflowNodeExecutor {
    const executor = this.executors.get(type);
    if (!executor) {
      throw new WorkflowRuntimeError(
        "workflow_executor_not_registered",
        `节点执行器未注册: ${type}`,
        nodeId
      );
    }
    return executor;
  }

  /** 编译或诊断入口可读取当前 Runtime 实际支持的节点类型。 */
  listTypes(): string[] {
    return [...this.executors.keys()].sort();
  }
}
