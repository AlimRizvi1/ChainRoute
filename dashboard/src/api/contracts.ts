import { apiRequest } from "./client";

export const CONTRACT_STATES = ["Created", "Booked", "InTransit", "Delivered", "PenaltyCalculated", "PaymentReleased", "Closed", "Disputed"] as const;
export type ContractState = typeof CONTRACT_STATES[number];
export type ContractSummary = {
  contractId: string;
  planId: string;
  state: ContractState;
  shipperId: string;
  carrierId: string;
  freightValuePaise?: string;
  slaDeadline?: string;
};
export type ContractDetail = ContractSummary & {
  terms?: {
    freightValuePaise: string;
    slaDeadline: string;
    penaltyBpsPerBlock: number;
    penaltyBlockSeconds: number;
    freeHoldingHours: number;
    demurrageRatePaisePerWagonHour: string;
    wagonCount: number;
  };
  termsHash?: string;
  assignments?: Array<{
    orderId: string; cargoType: string; quantityTonnes: number; wagonIds: string[];
    route: { routeId: string; origin: string; destination: string }; departAt: string; eta: string; onTimeProbability: number;
  }>;
  penaltyPaise?: string;
  demurragePaise?: string;
  netPaymentPaise?: string;
  history?: Array<{ action: string; actor: string; timestamp: string; dataHash: string }>;
};
export type ContractPage = { items: ContractSummary[]; nextCursor: string | null };
export type ContractAction = "confirm-booking" | "shipment-status" | "confirm-delivery" | "dispute" | "resolve-dispute" | "release-payment" | "close";
export type ContractActionResult = { contractId: string; state: ContractState; transactionHash?: string; onTime?: boolean; secondsLate?: number; penaltyPaise?: string; demurragePaise?: string; netPaymentPaise?: string };
export type QueuedContractAction = { status: "queued"; operationId: string; message: string };

export function listContracts(options: { state?: ContractState; cursor?: string } = {}) {
  const params = new URLSearchParams({ limit: "100" });
  if (options.state) params.set("state", options.state);
  if (options.cursor) params.set("cursor", options.cursor);
  return apiRequest<ContractPage>(`/contracts?${params.toString()}`);
}

export function getContract(contractId: string) {
  return apiRequest<ContractDetail>(`/contracts/${encodeURIComponent(contractId)}`);
}

export function performContractAction(contractId: string, action: ContractAction, body: Record<string, string> | undefined, idempotencyKey: string) {
  return apiRequest<ContractActionResult | QueuedContractAction>(`/contracts/${encodeURIComponent(contractId)}/${action}`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, ...(body ? { body } : {}),
  });
}
