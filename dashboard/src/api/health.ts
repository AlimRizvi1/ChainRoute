import { apiRequest } from "./client";

export type DependencyState = "up" | "down";
export type HealthResponse = {
  status: "ok" | "degraded";
  dependencies: {
    aiEngine: DependencyState;
    blockchain: DependencyState;
    database: DependencyState;
  };
  sampleData?: boolean;
};

export function getHealth(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>("/health", { auth: false });
}
