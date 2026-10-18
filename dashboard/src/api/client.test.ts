import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./client";
import { ApiError } from "./errors";
import { clearSession, writeSession } from "../auth/session";

const testSession = {
  token: "current-token",
  expiresAt: Date.now() + 60_000,
  user: { id: "user-1", username: "demo.shipper", role: "Shipper" as const },
};

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
});

describe("typed API client", () => {
  it("attaches the current bearer token and JSON body", async () => {
    writeSession(testSession);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ accepted: true }), { status: 200 }));
    await expect(apiRequest<{ accepted: boolean }>("/orders", {
      method: "POST", body: { quantityTonnes: 40 },
    })).resolves.toEqual({ accepted: true });
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer current-token");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ quantityTonnes: 40 }));
  });

  it("clears an expired server session and emits one app-wide redirect signal on 401", async () => {
    writeSession(testSession);
    const onExpired = vi.fn();
    window.addEventListener("chainroute:session-expired", onExpired);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      error: { code: "INVALID_TOKEN", message: "Sign in again." },
    }), { status: 401 }));
    await expect(apiRequest("/contracts")).rejects.toMatchObject({ status: 401, code: "INVALID_TOKEN" });
    expect(sessionStorage.getItem("chainroute.session.v1")).toBeNull();
    expect(onExpired).toHaveBeenCalledOnce();
    window.removeEventListener("chainroute:session-expired", onExpired);
  });

  it("normalizes an outage and never hides the dependency-specific status", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      error: { code: "BLOCKCHAIN_UNAVAILABLE", message: "The settlement service is unavailable." },
    }), { status: 503 }));
    const request = apiRequest("/contracts");
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({ status: 503, code: "BLOCKCHAIN_UNAVAILABLE" });
  });

  it("reports a malformed successful response as a service error", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("not json", { status: 200 }));
    await expect(apiRequest("/contracts")).rejects.toMatchObject({
      status: 502, code: "INVALID_RESPONSE",
    });
  });
});
