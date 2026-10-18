import { beforeEach, describe, expect, it } from "vitest";
import { clearSession, createSession, readSession, writeSession } from "./session";

const session = {
  token: "test-token",
  expiresAt: Date.now() + 60_000,
  user: { id: "user-1", username: "demo.shipper", role: "Shipper" as const },
};

beforeEach(() => sessionStorage.clear());

describe("tab-scoped authentication session", () => {
  it("persists a valid session for this tab and clears it on logout", () => {
    writeSession(session);
    expect(readSession()).toEqual(session);
    clearSession();
    expect(readSession()).toBeNull();
  });

  it("removes an expired or malformed value without exposing a session", () => {
    sessionStorage.setItem("chainroute.session.v1", JSON.stringify({ ...session, expiresAt: 1 }));
    expect(readSession()).toBeNull();
    expect(sessionStorage.getItem("chainroute.session.v1")).toBeNull();

    sessionStorage.setItem("chainroute.session.v1", "not-json");
    expect(readSession()).toBeNull();
    expect(sessionStorage.getItem("chainroute.session.v1")).toBeNull();
  });

  it("rejects an unrecognized server role and uses the server token expiry", () => {
    expect(() => createSession({
      token: "token", expiresIn: 900,
      user: { id: "user-1", username: "unknown", role: "Guest" as never },
    }, 1000)).toThrow("invalid login response");
    expect(createSession({
      token: "token", expiresIn: 900, user: session.user,
    }, 1000).expiresAt).toBe(901_000);
  });
});
