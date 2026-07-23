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

export type RuntimeError = {
  type: RuntimeErrorType | string;
  message: string;
  publicMessage: string;
  retryable: boolean;
};
