import { request } from "../../shared/api/client";

export type ToolListItem = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
};

export function listTools(): Promise<ToolListItem[]> {
  return request<ToolListItem[]>("/api/v1/tools");
}
