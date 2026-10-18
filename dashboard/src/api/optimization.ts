import { apiRequest } from "./client";

export type Weights = { onTime: number; cost: number; utilization: number };
export type Assignment = {
  orderId: string;
  cargoType: string;
  quantityTonnes: number;
  wagonIds: string[];
  route: { routeId: string; origin: string; destination: string };
  departAt: string;
  eta: string;
  onTimeProbability: number;
};
export type AllocationPlan = {
  planId: string;
  runId: string;
  score: number;
  assignments: Assignment[];
  unassignedOrders: Array<{ orderId: string; reasonCode: string; message: string }>;
  alternatives: Array<{ rank: number; score: number; assignments: Assignment[]; metrics: PlanMetrics }>;
  metrics: PlanMetrics;
  runMetadata: { generatedAt: string; durationMs: number; algorithm: string; weights: Weights; prediction?: { method: string; modelVersion: string | null } };
};
export type PlanMetrics = { utilizationPercent: number; estimatedCostPaise: string; distanceKm: number; onTimeProbability: number };
export type OrderInput = { cargoType: string; quantityTonnes: number; destination: string; priority: number; deadline: string };
export type AcceptInput = {
  carrierAddress: string;
  terms: {
    freightValuePaise: string;
    penaltyBpsPerBlock: number;
    penaltyBlockSeconds: number;
    freeHoldingHours: number;
    demurrageRatePaisePerWagonHour: string;
    wagonCount: number;
  };
};
export type ContractAcceptance = { contractId: string; planId: string; state: "Created"; agreementHash: string };
export type QueuedAcceptance = { status: "queued"; operationId: string; message: string };

export function createOrder(input: OrderInput) {
  return apiRequest<{ orderId: string; status: "Pending" }>("/orders", { method: "POST", body: input });
}

export function runOptimization(weights: Weights) {
  return apiRequest<AllocationPlan | { status: "empty"; message: string; plan: null }>("/optimizations/run", {
    method: "POST", body: { weights, timeBudgetSeconds: 5 },
  });
}

export function acceptPlan(planId: string, input: AcceptInput) {
  return apiRequest<ContractAcceptance | QueuedAcceptance>(`/plans/${encodeURIComponent(planId)}/accept`, {
    method: "POST",
    headers: { "Idempotency-Key": `dashboard-accept-${planId}` },
    body: input,
  });
}
