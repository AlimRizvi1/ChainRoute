import { apiRequest } from "./client";
import { hasPermission, type Role } from "../auth/roles";

export type ContractSummary = {
  contractId: string;
  planId: string;
  state: string;
  shipperId: string;
  carrierId: string;
  freightValuePaise?: string;
  slaDeadline?: string;
};

export type DashboardSummary = {
  pendingOrders: number;
  activeContracts: number;
  deliveredContracts: number;
  pendingPayments: number;
  wagonUtilizationPercent: number;
  allocationsToday: number;
  utilizationTrend: number[];
};

export type OverviewData = {
  summary: DashboardSummary;
  contracts: ContractSummary[];
  contractsError?: string;
  summaryError?: string;
  sampleData?: boolean;
};

export async function getOverview(role: Role): Promise<OverviewData> {
  const [contractsResult, summaryResult] = await Promise.allSettled([
    apiRequest<{ items: ContractSummary[]; sampleData?: boolean }>("/contracts?limit=100"),
    hasPermission(role, "dashboard.summary")
      ? apiRequest<DashboardSummary>("/dashboard/summary")
      : Promise.resolve(null),
  ]);
  const contracts = contractsResult.status === "fulfilled" ? contractsResult.value.items : [];
  const activeStates = new Set(["Created", "Booked", "InTransit", "Disputed"]);
  const derived: DashboardSummary = {
    pendingOrders: 0,
    activeContracts: contracts.filter((contract) => activeStates.has(contract.state)).length,
    deliveredContracts: contracts.filter((contract) => ["Delivered", "PenaltyCalculated", "PaymentReleased", "Closed"].includes(contract.state)).length,
    pendingPayments: contracts.filter((contract) => ["PenaltyCalculated", "Disputed"].includes(contract.state)).length,
    wagonUtilizationPercent: 0,
    allocationsToday: 0,
    utilizationTrend: [],
  };
  return {
    summary: summaryResult.status === "fulfilled" ? summaryResult.value ?? derived : derived,
    contracts,
    ...(contractsResult.status === "rejected" ? { contractsError: contractsResult.reason instanceof Error ? contractsResult.reason.message : "Contract activity could not be loaded." } : {}),
    ...(summaryResult.status === "rejected" ? { summaryError: summaryResult.reason instanceof Error ? summaryResult.reason.message : "Summary metrics could not be loaded." } : {}),
    ...(contractsResult.status === "fulfilled" && contractsResult.value.sampleData ? { sampleData: true } : {}),
  };
}
