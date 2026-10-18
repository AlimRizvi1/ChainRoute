import { useEffect, useState } from "react";
import { API_MODE, API_ROOT } from "../api/client";
import { getContract, type ContractDetail } from "../api/contracts";
import { readSession, type AuthSession } from "../auth/session";

export type LiveAlert = { id: string; contractId: string; title: string; message: string };
export type AlertConnection = "sample" | "connecting" | "connected" | "reconnecting" | "offline";

type ContractPush = { type: "contract.event"; contractId: string; action: string; occurredAt: string; state: string };

export function contractSocketUrl(apiRoot = API_ROOT, pageUrl = window.location.href): string {
  const target = new URL(apiRoot, pageUrl);
  target.pathname = "/ws/contracts";
  target.search = "";
  target.hash = "";
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  return target.toString();
}

export function useLiveContractAlerts(session: AuthSession) {
  const [connection, setConnection] = useState<AlertConnection>(API_MODE === "mock" ? "sample" : "connecting");
  const [alert, setAlert] = useState<LiveAlert | null>(null);

  useEffect(() => {
    if (API_MODE === "mock") {
      setConnection("sample");
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let retryAttempt = 0;
    const seen = new Set<string>();
    const sessionExpiryTimer = window.setTimeout(
      () => window.dispatchEvent(new Event("chainroute:session-expired")),
      Math.max(0, session.expiresAt - Date.now()),
    );

    const connect = () => {
      if (disposed) return;
      const current = readSession();
      if (!current || current.token !== session.token) {
        window.dispatchEvent(new Event("chainroute:session-expired"));
        return;
      }
      setConnection(retryAttempt ? "reconnecting" : "connecting");
      socket = new WebSocket(contractSocketUrl());
      socket.addEventListener("open", () => {
        socket?.send(JSON.stringify({ type: "authenticate", token: current.token }));
      });
      socket.addEventListener("message", (message) => {
        let event: unknown;
        try { event = JSON.parse(String(message.data)); } catch { return; }
        if (!event || typeof event !== "object") return;
        const payload = event as Record<string, unknown>;
        if (payload.type === "authenticated") {
          retryAttempt = 0;
          setConnection("connected");
          return;
        }
        if (payload.type !== "contract.event" || typeof payload.contractId !== "string" || typeof payload.action !== "string" || typeof payload.occurredAt !== "string" || typeof payload.state !== "string") return;
        const push: ContractPush = { type: "contract.event", contractId: payload.contractId, action: payload.action, occurredAt: payload.occurredAt, state: payload.state };
        const id = `${push.contractId}:${push.action}:${push.occurredAt}`;
        if (seen.has(id)) return;
        seen.add(id);
        if (seen.size > 200) seen.clear();
        void getContract(push.contractId).then((detail) => {
          if (disposed || (detail.shipperId !== session.user.id && detail.carrierId !== session.user.id)) return;
          window.dispatchEvent(new CustomEvent("chainroute:contract-event", { detail: push }));
          const nextAlert = createLiveAlert(push, detail);
          if (nextAlert) setAlert(nextAlert);
        }).catch(() => { /* The overview's normal refresh remains the fallback if a cached read is unavailable. */ });
      });
      socket.addEventListener("close", (event) => {
        if (disposed) return;
        if (event.code === 4401) {
          window.dispatchEvent(new Event("chainroute:session-expired"));
          setConnection("offline");
          return;
        }
        retryAttempt += 1;
        setConnection("reconnecting");
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(retryAttempt - 1, 5));
        retryTimer = window.setTimeout(connect, delay);
      });
      socket.addEventListener("error", () => setConnection("reconnecting"));
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      window.clearTimeout(sessionExpiryTimer);
      socket?.close(1000, "Workspace closed");
    };
  }, [session.token, session.user.id, session.expiresAt]);

  return { connection, alert, dismissAlert: () => setAlert(null) };
}

export function createLiveAlert(event: ContractPush, detail: ContractDetail): LiveAlert | null {
  if (event.state === "Disputed" || event.action === "DisputeRaised") {
    return { id: `${event.contractId}:${event.action}:${event.occurredAt}`, contractId: event.contractId, title: "Settlement on hold", message: `A dispute was recorded for contract ${event.contractId}.` };
  }
  if (event.action === "PenaltyCalculated") {
    const row = [...(detail.history ?? [])].reverse().find((item) => item.action === "PenaltyCalculated");
    const secondsLate = row?.details?.secondsLate;
    if (typeof secondsLate === "string" && /^\d+$/.test(secondsLate) && BigInt(secondsLate) > 0n) {
      return { id: `${event.contractId}:${event.action}:${event.occurredAt}`, contractId: event.contractId, title: "SLA missed", message: `Late delivery and settlement details are recorded for contract ${event.contractId}.` };
    }
  }
  if (event.action === "ShipmentStatusUpdated" && detail.terms?.slaDeadline) {
    const row = [...(detail.history ?? [])].reverse().find((item) => item.action === "ShipmentStatusUpdated");
    const timestamp = typeof row?.details?.timestamp === "string" ? Date.parse(row.details.timestamp) : Date.parse(event.occurredAt);
    const plannedEta = Math.max(0, ...(detail.assignments ?? []).map((assignment) => Date.parse(assignment.eta)).filter(Number.isFinite));
    const sla = Date.parse(detail.terms.slaDeadline);
    if (event.state === "InTransit" && Number.isFinite(sla) && plannedEta > sla) {
      return { id: `${event.contractId}:${event.action}:${event.occurredAt}`, contractId: event.contractId, title: "Shipment at risk", message: `The latest plan ETA is after the SLA for contract ${event.contractId}.` };
    }
    if (Number.isFinite(timestamp) && Number.isFinite(sla) && timestamp > sla) {
      return { id: `${event.contractId}:${event.action}:${event.occurredAt}`, contractId: event.contractId, title: "Shipment is past SLA", message: `A shipment milestone after the SLA was recorded for contract ${event.contractId}.` };
    }
  }
  return null;
}
