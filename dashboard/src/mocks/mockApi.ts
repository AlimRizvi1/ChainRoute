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
    const contracts = [
      { contractId: "CR-2048", planId: "plan-demo-0001", state: "InTransit", shipperId: "mock-shipper", carrierId: "mock-carrier", freightValuePaise: "232600000" },
      { contractId: "CR-2047", planId: "plan-demo-0002", state: "Booked", shipperId: "mock-shipper", carrierId: "mock-carrier", freightValuePaise: "184000000" },
      { contractId: "CR-2046", planId: "plan-demo-0003", state: "Disputed", shipperId: "mock-shipper", carrierId: "mock-carrier", freightValuePaise: "126500000" },
      { contractId: "CR-2045", planId: "plan-demo-0004", state: "Created", shipperId: "mock-shipper", carrierId: "mock-carrier", freightValuePaise: "96500000" },
      { contractId: "CR-2044", planId: "plan-demo-0005", state: "PenaltyCalculated", shipperId: "mock-shipper", carrierId: "mock-carrier", freightValuePaise: "148000000" },
    ];
    return json({ items: contracts, nextCursor: null, sampleData: true });
  }
  if (cleanPath === "/orders" && request.method === "GET") {
    return json({ items: plentifulDataset.orders, nextCursor: null, sampleData: true });
  }
  if (cleanPath === "/plans/demo" && request.method === "GET") {
    return json({ ...allocationPlan, sampleData: true });
  }
  return error(404, "NOT_FOUND", "This endpoint is not included in the Phase 1 mock API.");
}

export function isMockRole(value: unknown): value is Role {
  return isRole(value);
}
