import { afterEach, describe, expect, it, vi } from "vitest";
import { getOverview } from "./overview";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const contracts = {
  items: [
    { contractId: "CR-1", planId: "plan-1", state: "InTransit", shipperId: "s", carrierId: "c" },
    { contractId: "CR-2", planId: "plan-2", state: "Disputed", shipperId: "s", carrierId: "c" },
    { contractId: "CR-3", planId: "plan-3", state: "Closed", shipperId: "s", carrierId: "c" },
  ],
  sampleData: true,
};

afterEach(() => vi.unstubAllGlobals());

describe("overview data", () => {
  it("combines a role summary with visible contracts and mock label", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => Promise.resolve(
      String(input).includes("/contracts") ? response(contracts) : response({
        pendingOrders: 4, activeContracts: 2, deliveredContracts: 1, pendingPayments: 1,
        wagonUtilizationPercent: 67, allocationsToday: 2, utilizationTrend: [30, 40, 50, 60, 55, 62, 67],
      }),
    )));

    const result = await getOverview("Shipper");
    expect(result.summary.activeContracts).toBe(2);
    expect(result.contracts).toHaveLength(3);
    expect(result.sampleData).toBe(true);
  });

  it("keeps contract activity visible when summary metrics fail", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => Promise.resolve(
      String(input).includes("/contracts") ? response(contracts) : response({ error: { code: "DOWN", message: "Summary is unavailable." } }, 503),
    )));

    const result = await getOverview("Administrator");
    expect(result.summaryError).toContain("Summary is unavailable");
    expect(result.contracts).toHaveLength(3);
    expect(result.summary.activeContracts).toBe(2);
  });

  it.each(["Carrier", "Auditor"] as const)("uses role-visible contracts for %s without calling the restricted summary", async (role) => {
    const fetch = vi.fn(() => Promise.resolve(response(contracts)));
    vi.stubGlobal("fetch", fetch);

    const result = await getOverview(role);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.summary.pendingOrders).toBe(0);
    expect(result.summary.activeContracts).toBe(2);
    expect(result.summary.deliveredContracts).toBe(1);
  });
});
