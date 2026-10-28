import { request as httpRequest } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { AppRoutes } from "../src/app/AppRoutes";
import { AuthProvider } from "../src/auth/context";
import { writeSession } from "../src/auth/session";

// Component + real HTTP integration. Happy DOM does not provide layout or
// screenshots; these tests do not substitute for the manual browser checklist.
const api = process.env.CHAINROUTE_LIVE_API;
const evidenceDirectory = process.env.CHAINROUTE_INTEGRATION_EVIDENCE;
const enabled = Boolean(api && evidenceDirectory);
const suite = enabled ? describe : describe.skip;

suite("dashboard connected to the clean live platform", () => {
  configure({ asyncUtilTimeout: 15000 });
  let report: { scenarios: { late: { id: string } } };
  let sessions: { tokens: Record<string, string>; expiresAt: number };
  beforeEach(() => {
    report = JSON.parse(readFileSync(`${evidenceDirectory}/report.json`, "utf8").replace(/^\uFEFF/, ""));
    sessions = JSON.parse(readFileSync(`${evidenceDirectory}/sessions.json`, "utf8"));
    expect(sessions.expiresAt).toBeGreaterThan(Date.now());
    vi.stubGlobal("fetch", (input: string | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
      const url = new URL(String(input).replace(/^\/api/, ""), api);
      const request = httpRequest(url, { method: init.method || "GET", headers: Object.fromEntries(new Headers(init.headers)) }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve(new Response(Buffer.concat(chunks).toString(), {
          status: response.statusCode, headers: { "content-type": String(response.headers["content-type"] || "application/json") },
        })));
        response.on("error", reject);
      });
      request.on("error", reject);
      request.setTimeout(15000, () => request.destroy(new Error("Live API timed out")));
      if (init.body) request.write(init.body);
      request.end();
    }));
  });
  afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });

  function mount(role: "Shipper" | "Auditor") {
    const token = sessions.tokens[role.toLowerCase()];
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    writeSession({ token, expiresAt: sessions.expiresAt, user: { id: claims.sub, username: `demo.${role.toLowerCase()}`, role } });
    render(<MemoryRouter initialEntries={[`/contracts/${report.scenarios.late.id}`]}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
  }

  it("renders real settlement/tracking and navigates from contract through overview, allocation and ledger", async () => {
    mount("Shipper");
    await screen.findByRole("heading", { name: `Contract ${report.scenarios.late.id}` });
    expect(screen.getByRole("heading", { name: "Shipment tracking" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settlement breakdown" })).toBeInTheDocument();
    expect(screen.getAllByText("₹23,260.00").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Export settlement CSV" })).toBeEnabled();
    writeFileSync(`${evidenceDirectory}/shipper-contract-dom.html`, document.body.innerHTML);
    fireEvent.click(screen.getByRole("link", { name: "Overview", exact: true }));
    await screen.findByRole("heading", { name: "Freight, in motion." });
    fireEvent.click(screen.getByRole("link", { name: "Allocations", exact: true }));
    await screen.findByRole("heading", { name: "Set the freight in motion." });
    fireEvent.click(screen.getByRole("link", { name: "Contracts", exact: true }));
    await screen.findByRole("heading", { name: "Every handoff, recorded." });
    await waitFor(() => expect(screen.getByRole("link", { name: new RegExp(`CONTRACT ${report.scenarios.late.id}`) })).toBeInTheDocument());
  });

  it("renders the real Auditor event history without commercial amounts or mutation controls", async () => {
    mount("Auditor");
    await screen.findByRole("heading", { name: `Contract ${report.scenarios.late.id}` });
    expect(screen.getByText("Auditor view is read-only.")).toBeInTheDocument();
    expect(screen.getByText("Contract Closed")).toBeInTheDocument();
    expect(screen.queryByText("₹23,260.00")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm booking|Confirm delivery|Release payment|Close contract/ })).not.toBeInTheDocument();
    writeFileSync(`${evidenceDirectory}/auditor-contract-dom.html`, document.body.innerHTML);
  });
});
