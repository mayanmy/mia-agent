export class WorkflowRuntimeError extends Error {
  /** Runtime 错误只携带安全字段，调用方不能从事件中拿到堆栈或外部凭证。 */
  constructor(
    readonly type: string,
    message: string,
    readonly nodeId?: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = "WorkflowRuntimeError";
  }
}
