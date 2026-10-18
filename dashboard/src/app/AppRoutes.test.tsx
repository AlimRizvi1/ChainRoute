import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { AppRoutes } from "./AppRoutes";
import { AuthProvider } from "../auth/context";
import { writeSession } from "../auth/session";

function renderRoutes(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><AppRoutes /></AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.endsWith("/health")
      ? { status: "ok", dependencies: { aiEngine: "up", blockchain: "up", database: "up" } }
      : url.includes("/contracts")
        ? { items: [{ contractId: "CR-2048", planId: "plan-1", state: "InTransit", shipperId: "s", carrierId: "c" }] }
        : { pendingOrders: 2, activeContracts: 1, deliveredContracts: 0, pendingPayments: 0, wagonUtilizationPercent: 50, allocationsToday: 1, utilizationTrend: [10, 20, 30, 40, 50, 60, 50] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });

describe("dashboard route access", () => {
  it("redirects a logged-out user to the login screen", () => {
    renderRoutes("/contracts");
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });

  it("shows a carrier only the shared and carrier-accessible navigation", async () => {
    writeSession({
      token: "carrier-token", expiresAt: Date.now() + 60_000,
      user: { id: "carrier-1", username: "demo.carrier", role: "Carrier" },
    });
    renderRoutes("/overview");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Freight, in motion." })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Contracts/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Freight orders/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Audit trail/ })).not.toBeInTheDocument();
  });

  it("redirects a direct URL when the role cannot access its route", async () => {
    writeSession({
      token: "auditor-token", expiresAt: Date.now() + 60_000,
      user: { id: "auditor-1", username: "demo.auditor", role: "Auditor" },
    });
    renderRoutes("/orders");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Freight, in motion." })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Audit trail/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New freight order/ })).not.toBeInTheDocument();
  });

  it("returns to sign-in when the API expires a session", async () => {
    writeSession({
      token: "expired-token", expiresAt: Date.now() + 60_000,
      user: { id: "shipper-1", username: "demo.shipper", role: "Shipper" },
    });
    renderRoutes("/overview");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Freight, in motion." })).toBeInTheDocument());
    window.dispatchEvent(new Event("chainroute:session-expired"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Sign in to continue");
  });

  it("submits the backend login shape, stores its expiry, and redirects to the shared home", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const response = url.endsWith("/health")
        ? { status: "ok", dependencies: { aiEngine: "up", blockchain: "up", database: "up" } }
        : url.includes("/auth/login") ? {
            token: "signed-token", tokenType: "Bearer", expiresIn: 900,
            user: { id: "shipper-1", username: "demo.shipper", role: "Shipper" },
          }
          : url.includes("/contracts")
            ? { items: [] }
            : { pendingOrders: 0, activeContracts: 0, deliveredContracts: 0, pendingPayments: 0, wagonUtilizationPercent: 0, allocationsToday: 0, utilizationTrend: [0, 0, 0, 0, 0, 0, 0] };
      return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
    }));
    renderRoutes("/login");
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "demo.shipper" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "private-demo-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Freight, in motion." })).toBeInTheDocument());
    expect(sessionStorage.getItem("chainroute.session.v1")).toContain("signed-token");
  });
});
