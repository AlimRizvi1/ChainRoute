import { describe, expect, it } from "vitest";
import { canVisit, hasPermission, navigationForRole, ROLES } from "./roles";

describe("role-aware navigation", () => {
  it("shows each user only the routes allowed by the backend permission matrix", () => {
    expect(navigationForRole("Shipper").map((item) => item.href)).toEqual([
      "/overview", "/orders", "/allocations", "/ai-lab", "/contracts",
    ]);
    expect(navigationForRole("Carrier").map((item) => item.href)).toEqual([
      "/overview", "/ai-lab", "/contracts",
    ]);
    expect(navigationForRole("Administrator").map((item) => item.href)).toEqual([
      "/overview", "/orders", "/allocations", "/ai-lab", "/contracts", "/audit", "/admin",
    ]);
    expect(navigationForRole("Auditor").map((item) => item.href)).toEqual([
      "/overview", "/ai-lab", "/contracts", "/audit",
    ]);
  });

  it("guards direct navigation as well as visible links", () => {
    expect(canVisit("Carrier", "/orders")).toBe(false);
    expect(canVisit("Auditor", "/contracts")).toBe(true);
    expect(canVisit("Auditor", "/audit")).toBe(true);
    expect(canVisit("Shipper", "/audit")).toBe(false);
    expect(canVisit("Administrator", "/unknown")).toBe(false);
  });

  it("keeps the four role names aligned with the API contract", () => {
    expect(ROLES).toEqual(["Shipper", "Carrier", "Administrator", "Auditor"]);
    expect(hasPermission("Carrier", "contracts.shipment")).toBe(true);
    expect(hasPermission("Carrier", "contracts.resolveDispute")).toBe(false);
  });
});
