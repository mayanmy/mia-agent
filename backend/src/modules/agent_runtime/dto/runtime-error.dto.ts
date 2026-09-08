/** Runtime 对外稳定的错误分类；字符串联合便于前端做针对性提示。 */
export type RuntimeErrorType =
  | "agent_not_found"
  | "agent_disabled"
  | "model_unavailable"
  | "model_auth_failed"
  | "model_rate_limited"
  | "model_timeout"
  | "context_too_long"
  | "retrieval_failed"
  | "tool_not_found"
  | "tool_input_invalid"
  | "tool_execution_failed"
  | "tool_round_limit_exceeded"
  | "run_timeout"
  | "canceled"
  | "stream_interrupted"
  | "internal_error";

/** Runtime 失败事件中的统一错误结构。 */
export type RuntimeError = {
  /** 稳定错误分类；允许字符串是为了兼容下游扩展错误。 */
  type: RuntimeErrorType | string;
  /** 仅供日志与管理员排障的原始错误信息。 */
  message: string;
  /** 已脱敏、可以安全展示给终端用户的信息。 */
  publicMessage: string;
  /** 调用方是否可以在不改变输入的情况下重试。 */
  retryable: boolean;
};
