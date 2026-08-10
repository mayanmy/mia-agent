export type WorkflowNodeOutput = {
  output: Record<string, unknown>;
};

export type WorkflowContext = {
  input: Record<string, unknown>;
  nodes: Record<string, WorkflowNodeOutput>;
  runtime: {
    requestId: string;
    runId?: string;
    /** 独立 Workflow 运行不属于 Agent。 */
    agentId?: string;
    userId?: string;
    sessionId?: string;
    now: string;
  };
};

/** 创建单次运行隔离的 Context，避免不同请求共享可变节点输出。 */
export function createWorkflowContext(request: {
  requestId: string;
  runId?: string;
  /** Agent Tool 调用时存在，独立运行时为空。 */
  agentId?: string;
  userId?: string;
  sessionId?: string;
  inputs: Record<string, unknown>;
}): WorkflowContext {
  return {
    input: { ...request.inputs },
    nodes: {},
    runtime: {
      requestId: request.requestId,
      runId: request.runId,
      agentId: request.agentId,
      userId: request.userId,
      sessionId: request.sessionId,
      now: new Date().toISOString()
    }
  };
}
