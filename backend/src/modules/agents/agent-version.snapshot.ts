import { createHash } from "node:crypto";

import { AgentRuntimeMode, Prisma } from "@prisma/client";

import type { AgentRuntimeConfig, JsonValue } from "./dto/agent.dto";

export const AGENT_VERSION_SCHEMA_VERSION = 1;

export type AgentVersionSnapshotV1 = {
  schemaVersion: 1;
  runtime: Omit<AgentRuntimeConfig, "agentVersionId" | "configHash" | "runtimeMode">;
};

/** 规范化对象键顺序，同时保留数组业务顺序，确保相同配置得到相同 Hash。 */
export function canonicalizeAgentVersionValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeAgentVersionValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalizeAgentVersionValue(item)])
    );
  }
  return null;
}

export function createAgentVersionSnapshot(runtime: AgentRuntimeConfig): {
  snapshot: AgentVersionSnapshotV1;
  configHash: string;
  prismaJson: Prisma.InputJsonValue;
} {
  const { agentVersionId: _version, configHash: _hash, runtimeMode: _mode, ...stable } = runtime;
  const snapshot = canonicalizeAgentVersionValue({
    schemaVersion: AGENT_VERSION_SCHEMA_VERSION,
    runtime: stable
  }) as AgentVersionSnapshotV1;
  const serialized = JSON.stringify(snapshot);
  return {
    snapshot,
    configHash: createHash("sha256").update(serialized).digest("hex"),
    prismaJson: snapshot as unknown as Prisma.InputJsonValue
  };
}

export function hydrateAgentVersionSnapshot(
  value: Prisma.JsonValue,
  expectedHash: string,
  mode: AgentRuntimeMode
): AgentRuntimeConfig {
  const normalized = canonicalizeAgentVersionValue(value);
  const actualHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  if (actualHash !== expectedHash) throw new Error("AgentVersion config hash mismatch");
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw new Error("AgentVersion snapshot is invalid");
  }
  const record = normalized as Record<string, JsonValue>;
  if (record.schemaVersion !== AGENT_VERSION_SCHEMA_VERSION) {
    throw new Error("AgentVersion schema version is unsupported");
  }
  const runtime = record.runtime;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    throw new Error("AgentVersion runtime snapshot is invalid");
  }
  return {
    ...(runtime as unknown as Omit<
      AgentRuntimeConfig,
      "agentVersionId" | "configHash" | "runtimeMode"
    >),
    agentVersionId: null,
    configHash: expectedHash,
    runtimeMode: mode
  };
}
