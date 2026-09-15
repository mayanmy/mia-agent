/** 工具实现向 ToolsService 传递的稳定错误分类，避免仅凭 AbortError 猜测超时或取消。 */
export class ToolRuntimeError extends Error {
  constructor(
    readonly errorType: string,
    message: string
  ) {
    super(message);
    this.name = "ToolRuntimeError";
  }
}
