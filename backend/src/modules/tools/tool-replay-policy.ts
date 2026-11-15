import { ToolReplayMetadata, ToolReplayPolicy, ToolSideEffectLevel } from "./dto/tool.dto";

const POLICY_SAFETY_RANK: Record<ToolReplayPolicy, number> = {
  REEXECUTE: 0,
  REUSE: 1,
  REQUIRE_CONFIRMATION: 2,
  FORBIDDEN: 3
};

/** 根据副作用与幂等能力计算平台最低安全策略。 */
export function minimumReplayPolicy(metadata: ToolReplayMetadata): ToolReplayPolicy {
  if (metadata.sideEffectLevel === "NONE") return "REUSE";
  if (metadata.sideEffectLevel === "READ") return "REEXECUTE";
  if (metadata.sideEffectLevel === "IDEMPOTENT_WRITE") {
    return metadata.idempotency?.supported ? "REEXECUTE" : "FORBIDDEN";
  }
  if (metadata.sideEffectLevel === "NON_IDEMPOTENT_WRITE") return "REQUIRE_CONFIRMATION";
  return "FORBIDDEN";
}

/** Workflow 节点可以提高限制，但不能把未知或非幂等写操作改成自动重执行。 */
export function resolveReplayPolicy(
  metadata: ToolReplayMetadata,
  requested?: unknown
): ToolReplayPolicy {
  const minimum = minimumReplayPolicy(metadata);
  if (requested === undefined) return metadata.replayPolicy;
  if (!isReplayPolicy(requested)) throw new Error("replayPolicy 无效");
  if (POLICY_SAFETY_RANK[requested] < POLICY_SAFETY_RANK[minimum]) {
    throw new Error(
      `replayPolicy ${requested} 不能放宽 ${metadata.sideEffectLevel} 工具的最低策略 ${minimum}`
    );
  }
  if (
    requested === "REUSE" &&
    metadata.sideEffectLevel === "IDEMPOTENT_WRITE" &&
    !metadata.idempotency?.resultLookupSupported
  ) {
    throw new Error("幂等写工具未声明结果查询能力，不能复用历史结果");
  }
  return requested;
}

export function isReplayPolicy(value: unknown): value is ToolReplayPolicy {
  return (
    value === "REUSE" ||
    value === "REEXECUTE" ||
    value === "REQUIRE_CONFIRMATION" ||
    value === "FORBIDDEN"
  );
}

/** 风险聚合使用固定序，嵌套 Workflow 后续可取所有可达工具中的最高等级。 */
export function highestSideEffectLevel(levels: ToolSideEffectLevel[]): ToolSideEffectLevel {
  const rank: Record<ToolSideEffectLevel, number> = {
    NONE: 0,
    READ: 1,
    IDEMPOTENT_WRITE: 2,
    NON_IDEMPOTENT_WRITE: 3,
    UNKNOWN: 4
  };
  return levels.reduce<ToolSideEffectLevel>(
    (highest, current) => (rank[current] > rank[highest] ? current : highest),
    "NONE"
  );
}
