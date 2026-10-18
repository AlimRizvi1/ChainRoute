import { describe, expect, it } from "vitest";
import { mockRequest } from "./mockApi";

describe("Phase 1 sample API", () => {
  it("supports the four synthetic demo identities", async () => {
    for (const username of ["demo.shipper", "demo.carrier", "demo.administrator", "demo.auditor"]) {
      const response = await mockRequest("/auth/login", {
        method: "POST", body: { username, password: "local-only" },
      });
      expect(response.status).toBe(200);
      expect((await response.json()).user.username).toBe(username);
    }
  });

  it("serves labeled sample records and rejects unknown paths", async () => {
    const orders = await mockRequest("/orders", { method: "GET", token: "mock-demo" });
    expect(orders.status).toBe(200);
    expect((await orders.json()).sampleData).toBe(true);
    const missing = await mockRequest("/plans/does-not-exist", { method: "GET", token: "mock-demo" });
    expect(missing.status).toBe(404);
  });
});
