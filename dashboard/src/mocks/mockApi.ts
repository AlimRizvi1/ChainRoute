import plentifulDataset from "../../../samples/plentiful-dataset.json";
import allocationPlan from "../../../samples/allocation-plan.json";
import { isRole, type Role } from "../auth/roles";

type MockRequest = { method: string; body?: unknown; token?: string };

const demoRoles: Record<string, Role> = {
  "demo.shipper": "Shipper",
  "demo.carrier": "Carrier",
  "demo.administrator": "Administrator",
  "demo.auditor": "Auditor",
};
let mockRunNumber = 0;
let mockOrderNumber = 0;
let mockContracts: Array<Record<string, any>> = [
  { contractId: "2048", planId: "plan-demo-0001", state: "InTransit", shipperId: "mock-shipper", carrierId: "mock-carrier", freightValuePaise: "232600000", slaDeadline: "2026-11-02T18:00:00Z" },
  { contractId: "2047", planId: "plan-demo-0002", state: "Booked", shipperId: "mock-shipper", carrierId: "mock-carrier", freightValuePaise: "184000000", slaDeadline: "2026-11-04T18:00:00Z" },
  { contractId: "2046", planId: "plan-demo-0003", state: "Disputed", shipperId: "mock-shipper", carrierId: "mock-carrier", freightValuePaise: "126500000", slaDeadline: "2026-11-05T18:00:00Z" },
  { contractId: "2045", planId: "plan-demo-0004", state: "Created", shipperId: "mock-shipper", carrierId: "mock-carrier", freightValuePaise: "96500000", slaDeadline: "2026-11-06T18:00:00Z" },
  { contractId: "2044", planId: "plan-demo-0005", state: "PenaltyCalculated", shipperId: "mock-shipper", carrierId: "mock-carrier", freightValuePaise: "148000000", slaDeadline: "2026-11-01T18:00:00Z" },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function error(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

export async function mockRequest(path: string, request: MockRequest): Promise<Response> {
  const cleanPath = path.split("?")[0].replace(/\/$/, "") || "/";
  if (request.method === "POST" && cleanPath === "/auth/login") {
    const body = request.body as { username?: unknown; password?: unknown } | undefined;
    const username = typeof body?.username === "string" ? body.username : "";
    const role = demoRoles[username];
    if (!role || typeof body?.password !== "string" || !body.password) {
      return error(401, "INVALID_CREDENTIALS", "Choose a demo user and enter any non-empty password in mock mode.");
    }
    return json({
      token: `mock-${username}`,
      tokenType: "Bearer",
      expiresIn: 900,
      user: { id: `mock-${role.toLowerCase()}`, username, role },
    });
  }

  if (cleanPath === "/health" && request.method === "GET") {
    return json({
      status: "ok",
      dependencies: { aiEngine: "up", blockchain: "up", database: "up" },
      sampleData: true,
    });
  }
  if (!request.token) return error(401, "INVALID_TOKEN", "Sign in to continue.");
  if (cleanPath === "/dashboard/summary" && request.method === "GET") {
    return json({
      pendingOrders: 12,
      activeContracts: 8,
      deliveredContracts: 17,
      pendingPayments: 3,
      wagonUtilizationPercent: 74,
      allocationsToday: 5,
      utilizationTrend: [58, 62, 60, 68, 65, 71, 74],
      sampleData: true,
    });
  }
  if (cleanPath === "/contracts" && request.method === "GET") {
    const params = new URLSearchParams(path.split("?")[1] ?? "");
    const state = params.get("state");
    const items = state ? mockContracts.filter((contract) => contract.state === state) : mockContracts;
    return json({ items, nextCursor: null, sampleData: true });
  }
  const detailMatch = cleanPath.match(/^\/contracts\/([^/]+)$/);
  if (detailMatch && request.method === "GET") {
    const contract = mockContracts.find((entry) => entry.contractId === decodeURIComponent(detailMatch[1]));
    if (!contract) return error(404, "NOT_FOUND", "Contract was not found.");
    const roleKey = Object.keys(demoRoles).find((username) => request.token === `mock-${username}`);
    const role = roleKey ? demoRoles[roleKey] : "Auditor";
    const history = [{ action: "AgreementCreated", actor: `0x${"1".repeat(40)}`, timestamp: "2026-10-18T08:00:00Z", dataHash: `0x${"c".repeat(64)}` }, { action: contract.state === "InTransit" ? "ShipmentStatusUpdated" : "ContractStateChanged", actor: `0x${"2".repeat(40)}`, timestamp: "2026-10-18T09:00:00Z", dataHash: `0x${"d".repeat(64)}` }];
    if (role === "Administrator" || role === "Auditor") return json({ contractId: contract.contractId, planId: contract.planId, state: contract.state, shipperId: contract.shipperId, carrierId: contract.carrierId, history, sampleData: true });
    const payload = allocationPlan as typeof allocationPlan & Record<string, any>;
    return json({
      contractId: contract.contractId, planId: contract.planId, state: contract.state, shipperId: contract.shipperId, carrierId: contract.carrierId,
      terms: { freightValuePaise: contract.freightValuePaise, slaDeadline: contract.slaDeadline, penaltyBpsPerBlock: 100, penaltyBlockSeconds: 3600, freeHoldingHours: 4, demurrageRatePaisePerWagonHour: "5000", wagonCount: 10 },
      termsHash: `0x${"a".repeat(64)}`, assignments: payload.assignments,
      penaltyPaise: "150000", demurragePaise: "24000", netPaymentPaise: "2326000",
      history, sampleData: true,
    });
  }
  const actionMatch = cleanPath.match(/^\/contracts\/([^/]+)\/(confirm-booking|shipment-status|confirm-delivery|dispute|resolve-dispute|release-payment|close)$/);
  if (actionMatch && request.method === "POST") {
    const contract = mockContracts.find((entry) => entry.contractId === decodeURIComponent(actionMatch[1]));
    if (!contract) return error(404, "NOT_FOUND", "Contract was not found.");
    const nextState: Record<string, string> = { "confirm-booking": "Booked", "shipment-status": "InTransit", "confirm-delivery": "PenaltyCalculated", dispute: "Disputed", "resolve-dispute": "PenaltyCalculated", "release-payment": "PaymentReleased", close: "Closed" };
    contract.state = nextState[actionMatch[2]];
    return json({ contractId: contract.contractId, state: contract.state, ...(actionMatch[2] === "confirm-delivery" ? { onTime: false, secondsLate: 3600, penaltyPaise: "150000", demurragePaise: "24000", netPaymentPaise: "2326000" } : {}) });
  }
  if (cleanPath === "/orders" && request.method === "GET") {
    return json({ items: plentifulDataset.orders, nextCursor: null, sampleData: true });
  }
  if (cleanPath === "/orders" && request.method === "POST") {
    mockOrderNumber += 1;
    return json({ orderId: `ORD-MOCK-${String(mockOrderNumber).padStart(3, "0")}`, status: "Pending" }, 201);
  }
  if (cleanPath === "/optimizations/run" && request.method === "POST") {
    mockRunNumber += 1;
    const input = request.body as { weights?: { onTime?: number; cost?: number; utilization?: number } } | undefined;
    const weights = input?.weights ?? { onTime: 0.5, cost: 0.3, utilization: 0.2 };
    const total = (weights.onTime ?? 0) + (weights.cost ?? 0) + (weights.utilization ?? 0) || 1;
    const normalized = { onTime: (weights.onTime ?? 0) / total, cost: (weights.cost ?? 0) / total, utilization: (weights.utilization ?? 0) / total };
    const plan = structuredClone(allocationPlan) as typeof allocationPlan & { metrics: { utilizationPercent: number; estimatedCostPaise: string; distanceKm: number; onTimeProbability: number }; runMetadata: { generatedAt: string; durationMs: number; algorithm: string; weights: typeof normalized; inputHash: string }; planId: string; runId: string };
    plan.planId = `plan-mock-${String(mockRunNumber).padStart(4, "0")}`;
    plan.runId = `run-mock-${String(mockRunNumber).padStart(4, "0")}`;
    plan.runMetadata = { ...plan.runMetadata, generatedAt: new Date().toISOString(), durationMs: 720 + mockRunNumber * 31, weights: normalized, algorithm: "yard-demo-v1", inputHash: `sha256:${"a".repeat(64)}` };
    plan.metrics = {
      utilizationPercent: Math.round(62 + normalized.utilization * 35),
      estimatedCostPaise: String(Math.round(530000 - normalized.cost * 220000)),
      distanceKm: Math.round(1100 - normalized.cost * 200),
      onTimeProbability: Number((0.52 + normalized.onTime * 0.42).toFixed(3)),
    };
    return json({ ...plan, sampleData: true });
  }
  if (/^\/plans\/[^/]+\/accept$/.test(cleanPath) && request.method === "POST") {
    const planId = cleanPath.split("/")[2];
    const contractNumber = Math.max(mockRunNumber, 1);
    const contractId = String(3000 + contractNumber);
    mockContracts.unshift({ contractId, planId, state: "Created", shipperId: "mock-shipper", carrierId: "mock-carrier", freightValuePaise: "2500000", slaDeadline: "2026-12-01T12:00:00Z" });
    return json({ contractId, planId, state: "Created", agreementHash: `0x${"b".repeat(64)}` });
  }
  if (cleanPath === "/plans/demo" && request.method === "GET") {
    return json({ ...allocationPlan, sampleData: true });
  }
  return error(404, "NOT_FOUND", "This endpoint is not included in the Phase 1 mock API.");
}

export function isMockRole(value: unknown): value is Role {
  return isRole(value);
}
