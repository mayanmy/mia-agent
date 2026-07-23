import { AgentRunStepType } from "@prisma/client";

export type TraceJsonPrimitive = string | number | boolean | null;
export type TraceJsonValue = TraceJsonPrimitive | TraceJsonObject | TraceJsonValue[];
export type TraceJsonObject = { [key: string]: TraceJsonValue };

export type StartAgentRunStepDto = {
  runId: string;
  sequence: number;
  type: AgentRunStepType;
  name: string;
  input?: TraceJsonValue;
};

export type AgentRunStepContext = {
  stepId: string;
  runId: string;
  sequence: number;
  startedAt: Date;
};
