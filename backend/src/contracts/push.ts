import { URL } from "node:url";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import WebSocket, { WebSocketServer } from "ws";
import type { AuthenticatedActor } from "../auth/fastify.js";

export type ContractPushEvent = {
  contractId: string;
  action: string;
  occurredAt: string;
  transactionHash: string | null;
  state: string;
};

export function registerContractPush(app: FastifyInstance, database: Pool) {
  const clients = new Map<WebSocket, AuthenticatedActor>();
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });

  app.server.on("upgrade", (request, socket, head) => {
    let path: string;
    try { path = new URL(request.url ?? "/", "http://localhost").pathname; }
    catch { socket.destroy(); return; }
    if (path !== "/ws/contracts") return;
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });

  websocketServer.on("connection", (websocket) => {
    let authenticated = false;
    const authTimer = setTimeout(() => websocket.close(4401, "Authentication required"), 5000);
    websocket.on("message", async (message) => {
      if (authenticated) return;
      try {
        const envelope = JSON.parse(message.toString()) as { type?: unknown; token?: unknown };
        if (envelope.type !== "authenticate" || typeof envelope.token !== "string" || envelope.token.length > 4096) {
          websocket.close(4401, "Invalid authentication message");
          return;
        }
        const claims = app.jwt.verify<{ sub: string; role: string }>(envelope.token);
        const result = await database.query<AuthenticatedActor>(
          `SELECT user_id AS "userId", username, role, chain_address AS "chainAddress"
           FROM users WHERE user_id = $1 AND active = true`,
          [claims.sub],
        );
        const actor = result.rows[0];
        if (!actor || actor.role !== claims.role || !["Shipper", "Carrier", "Administrator", "Auditor"].includes(actor.role)) {
          websocket.close(4401, "Invalid authentication");
          return;
        }
        authenticated = true;
        clearTimeout(authTimer);
        clients.set(websocket, actor);
        websocket.send(JSON.stringify({ type: "authenticated", role: actor.role }));
      } catch {
        websocket.close(4401, "Invalid authentication");
      }
    });
    websocket.on("close", () => {
      clearTimeout(authTimer);
      clients.delete(websocket);
    });
    websocket.on("error", () => clients.delete(websocket));
  });

  app.addHook("onClose", async () => {
    for (const websocket of clients.keys()) websocket.close(1001, "Server shutting down");
    await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
  });

  return {
    broadcast(event: ContractPushEvent, shipperId: string, carrierId: string) {
      const message = JSON.stringify({ type: "contract.event", ...event });
      for (const [websocket, actor] of clients) {
        const isParty = actor.userId === shipperId || actor.userId === carrierId;
        if (isParty && websocket.readyState === WebSocket.OPEN) websocket.send(message);
      }
    },
  };
}
