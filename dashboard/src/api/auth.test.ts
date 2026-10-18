import { afterEach, describe, expect, it, vi } from "vitest";
import { login } from "./auth";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("authentication API", () => {
  it("refuses an invalid login payload without persisting a session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      token: "token", tokenType: "Bearer", expiresIn: 900,
      user: { id: "user-1", username: "demo.shipper", role: "UnknownRole" },
    }), { status: 200, headers: { "content-type": "application/json" } })));
    await expect(login("demo.shipper", "password")).rejects.toThrow("invalid login response");
    expect(sessionStorage.getItem("chainroute.session.v1")).toBeNull();
  });
});
