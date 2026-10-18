import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContractDetail } from "../api/contracts";
import { getContract } from "../api/contracts";
import { writeSession, type AuthSession } from "../auth/session";
import { contractSocketUrl, createLiveAlert } from "./useLiveContractAlerts";
import { useLiveContractAlerts } from "./useLiveContractAlerts";

vi.mock("../api/contracts", () => ({ getContract: vi.fn() }));

const detail: ContractDetail = {
  contractId: "CR-2044", planId: "plan-1", state: "PenaltyCalculated", shipperId: "shipper-1", carrierId: "carrier-1",
  terms: { freightValuePaise: "2500000", slaDeadline: "2026-11-01T18:00:00Z", penaltyBpsPerBlock: 200, penaltyBlockSeconds: 21600, freeHoldingHours: 6, demurrageRatePaisePerWagonHour: "500", wagonCount: 12 },
  history: [{ action: "PenaltyCalculated", actor: "0x1", timestamp: "2026-11-02T07:00:00Z", dataHash: "0x1", details: { secondsLate: "46800" } }],
};

class FakeWebSocket extends EventTarget {
  readyState = 0;
  sent: string[] = [];
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  receive(data: string) { this.dispatchEvent(new MessageEvent("message", { data })); }
}

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); sessionStorage.clear(); });

describe("live contract alerts", () => {
  it("uses the API host and secure websocket protocol when configured", () => {
    expect(contractSocketUrl("/api", "https://chainroute.example/overview")).toBe("wss://chainroute.example/ws/contracts");
    expect(contractSocketUrl("http://localhost:8080/api", "http://localhost:5173/overview")).toBe("ws://localhost:8080/ws/contracts");
  });

  it("turns a late settlement event into an alert and ignores an on-time one", () => {
    const event = { type: "contract.event", contractId: "CR-2044", action: "PenaltyCalculated", occurredAt: "2026-11-02T07:00:00Z", state: "PenaltyCalculated" } as const;
    expect(createLiveAlert(event, detail)).toMatchObject({ title: "SLA missed", contractId: "CR-2044" });
    const onTime = { ...detail, history: [{ ...detail.history![0], details: { secondsLate: "0" } }] };
    expect(createLiveAlert(event, onTime)).toBeNull();
  });

  it("flags a plan ETA beyond the SLA after a shipment update", () => {
    const event = { type: "contract.event", contractId: "CR-2044", action: "ShipmentStatusUpdated", occurredAt: "2026-11-01T17:00:00Z", state: "InTransit" } as const;
    const atRisk = { ...detail, state: "InTransit" as const, assignments: [{ orderId: "ORD-1", cargoType: "grain", quantityTonnes: 40, wagonIds: ["WAG-1"], route: { routeId: "RTE-1", origin: "Yard A", destination: "Port A" }, departAt: "2026-11-01T00:00:00Z", eta: "2026-11-02T19:00:00Z", onTimeProbability: 0.5 }] };
    expect(createLiveAlert(event, atRisk)?.title).toBe("Shipment at risk");
  });

  it("calls out disputes with text that does not rely on color", () => {
    const event = { type: "contract.event", contractId: "CR-2044", action: "DisputeRaised", occurredAt: "2026-11-02T08:00:00Z", state: "Disputed" } as const;
    expect(createLiveAlert(event, { ...detail, state: "Disputed" })?.title).toBe("Settlement on hold");
  });

  it("authenticates the socket, refreshes entitled contract state, and announces live alerts", async () => {
    const session: AuthSession = { token: "party-token", expiresAt: Date.now() + 60_000, user: { id: "shipper-1", username: "demo.shipper", role: "Shipper" } };
    writeSession(session);
    let socket!: FakeWebSocket;
    class FakeWebSocketConstructor extends FakeWebSocket { constructor() { super(); socket = this; } }
    vi.stubGlobal("WebSocket", FakeWebSocketConstructor);
    vi.mocked(getContract).mockResolvedValue(detail);
    const received = vi.fn();
    window.addEventListener("chainroute:contract-event", received);
    const { result, unmount } = renderHook(() => useLiveContractAlerts(session));
    act(() => socket.open());
    expect(socket.sent).toEqual([JSON.stringify({ type: "authenticate", token: "party-token" })]);
    act(() => socket.receive(JSON.stringify({ type: "authenticated", role: "Shipper" })));
    expect(result.current.connection).toBe("connected");
    act(() => socket.receive(JSON.stringify({ type: "contract.event", contractId: "CR-2044", action: "PenaltyCalculated", occurredAt: "2026-11-02T07:00:00Z", state: "PenaltyCalculated" })));
    await waitFor(() => expect(result.current.alert?.title).toBe("SLA missed"));
    expect(received).toHaveBeenCalledTimes(1);
    expect(getContract).toHaveBeenCalledWith("CR-2044");
    unmount();
    window.removeEventListener("chainroute:contract-event", received);
  });

  it("drops a push when the fetched contract is outside the signed-in party", async () => {
    const session: AuthSession = { token: "party-token", expiresAt: Date.now() + 60_000, user: { id: "shipper-1", username: "demo.shipper", role: "Shipper" } };
    writeSession(session);
    let socket!: FakeWebSocket;
    class FakeWebSocketConstructor extends FakeWebSocket { constructor() { super(); socket = this; } }
    vi.stubGlobal("WebSocket", FakeWebSocketConstructor);
    vi.mocked(getContract).mockResolvedValue({ ...detail, shipperId: "different-user", carrierId: "different-carrier" });
    const received = vi.fn();
    window.addEventListener("chainroute:contract-event", received);
    const { result, unmount } = renderHook(() => useLiveContractAlerts(session));
    act(() => socket.open());
    act(() => socket.receive(JSON.stringify({ type: "authenticated", role: "Shipper" })));
    act(() => socket.receive(JSON.stringify({ type: "contract.event", contractId: "CR-2044", action: "DisputeRaised", occurredAt: "2026-11-02T08:00:00Z", state: "Disputed" })));
    await waitFor(() => expect(getContract).toHaveBeenCalledWith("CR-2044"));
    expect(result.current.alert).toBeNull();
    expect(received).not.toHaveBeenCalled();
    unmount();
    window.removeEventListener("chainroute:contract-event", received);
  });
});
