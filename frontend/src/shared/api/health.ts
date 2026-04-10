import { request } from "./client";

export type HealthData = {
  status: string;
  appName: string;
  version: string;
  environment: string;
};

export function getHealth(): Promise<HealthData> {
  return request<HealthData>("/api/v1/health");
}

