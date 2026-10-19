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
  const clients = new Map<WebSocket, { actor: AuthenticatedActor; expiresAt: number }>();
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
    let authenticating = false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const authTimer = setTimeout(() => websocket.close(4401, "Authentication required"), 5000);
    websocket.on("message", async (message) => {
      if (authenticated || authenticating) return;
      authenticating = true;
      try {
        const envelope = JSON.parse(message.toString()) as { type?: unknown; token?: unknown };
        if (envelope.type !== "authenticate" || typeof envelope.token !== "string" || envelope.token.length > 4096) {
          websocket.close(4401, "Invalid authentication message");
          return;
        }
        const claims = app.jwt.verify<{ sub: string; role: string; exp: number }>(envelope.token);
        if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) {
          websocket.close(4401, "Session expired"); return;
        }
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
        clients.set(websocket, { actor, expiresAt: claims.exp * 1000 });
        expiryTimer = setTimeout(() => websocket.close(4401, "Session expired"), Math.min(2_147_483_647, Math.max(0, claims.exp * 1000 - Date.now())));
        websocket.send(JSON.stringify({ type: "authenticated", role: actor.role }));
      } catch {
        websocket.close(4401, "Invalid authentication");
      }
    });
    websocket.on("close", () => {
      clearTimeout(authTimer);
      clearTimeout(expiryTimer);
      clients.delete(websocket);
    });
    websocket.on("error", () => { clearTimeout(authTimer); clearTimeout(expiryTimer); clients.delete(websocket); });
  });

  app.addHook("onClose", async () => {
    for (const websocket of clients.keys()) websocket.close(1001, "Server shutting down");
    await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
  });

  return {
    async broadcast(event: ContractPushEvent, shipperId: string, carrierId: string) {
      const message = JSON.stringify({ type: "contract.event", ...event });
      const parties = [...clients].filter(([, { actor }]) => actor.userId === shipperId || actor.userId === carrierId);
      if (!parties.length) return;
      // A socket's original authentication is insufficient after account access
      // changes. Recheck active status and role before releasing party events.
      const current = await database.query<{ user_id: string; role: string }>(
        "SELECT user_id, role FROM users WHERE user_id = ANY($1::uuid[]) AND active = true", [[shipperId, carrierId]],
      );
      const roles = new Map(current.rows.map((user) => [user.user_id, user.role]));
      for (const [websocket, { actor, expiresAt }] of parties) {
        if (roles.get(actor.userId) !== actor.role || expiresAt <= Date.now()) {
          websocket.close(4401, "Account access changed or session expired");
        } else if (websocket.readyState === WebSocket.OPEN) websocket.send(message);
      }
    },
  };
}
