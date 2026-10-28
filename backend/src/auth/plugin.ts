import fastifyJwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { canPerform, isPermission, isRole } from "./authorization.js";
import { verifyPassword } from "./password.js";
import { registerAccountRoutes } from "./accounts.js";
import { ACCESS_TOKEN_SECONDS, sendSession } from "./session.js";
import type { AuthenticatedActor } from "./fastify.js";

const TOKEN_ISSUER = "chainroute-platform";
const TOKEN_AUDIENCE = "chainroute-dashboard";
export { ACCESS_TOKEN_SECONDS } from "./session.js";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type LoginBody = { username: string; password: string };

const loginSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["username", "password"],
    properties: {
      username: { type: "string", minLength: 1, maxLength: 128 },
      password: { type: "string", minLength: 1, maxLength: 256 },
    },
  },
};

export async function registerAuthentication(
  app: FastifyInstance,
  database: Pool,
  tokenSecret: string,
): Promise<void> {
  await app.register(fastifyJwt, {
    secret: tokenSecret,
    sign: {
      algorithm: "HS256",
      iss: TOKEN_ISSUER,
      aud: TOKEN_AUDIENCE,
      expiresIn: ACCESS_TOKEN_SECONDS,
    },
    verify: {
      algorithms: ["HS256"],
      allowedIss: TOKEN_ISSUER,
      allowedAud: TOKEN_AUDIENCE,
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
    hook: "onRequest",
  });
  app.decorateRequest("actor", null);

  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/auth/") || request.url.startsWith("/admin/")) reply.header("cache-control", "no-store");
    if (request.routeOptions.config.public === true) return;
    await authenticateRequest(request, reply, database);
    // Await the response pipeline even while its asynchronous audit hook runs.
    // Otherwise a rejected request can continue into a handler without an actor.
    if (!request.actor) return reply;
  });

  app.addHook("preHandler", async (request, reply) => {
    if (reply.sent) return;
    if (request.routeOptions.config.public === true) return;
    const permission = request.routeOptions.config.permission;
    if (!permission || !isPermission(permission)) {
      return sendError(reply, 403, "FORBIDDEN", "You are not allowed to perform this action.");
    }
    if (!request.actor) return reply;
    if (!canPerform(request.actor.role, permission, request.actor.userId)) {
      return sendError(reply, 403, "FORBIDDEN", "You are not allowed to perform this action.");
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (!MUTATING_METHODS.has(request.method) || request.routeOptions.config.auditAction === "auth.login") {
      return payload;
    }

    const action = request.routeOptions.config.auditAction ??
      `${request.method} ${request.routeOptions.url ?? request.url.split("?")[0]}`;
    const routeParams = request.params as Record<string, unknown>;
    const routeResourceId = ["contractId", "planId", "orderId", "userId", "wagonId", "routeId"]
      .map((key) => routeParams?.[key])
      .find((value): value is string => typeof value === "string") ?? null;
    const resourceBody = request.body as { wagonId?: unknown; routeId?: unknown } | undefined;
    const bodyResourceId = request.routeOptions.config.auditResourceType === "wagon" ? resourceBody?.wagonId
      : request.routeOptions.config.auditResourceType === "route" ? resourceBody?.routeId : null;
    const resourceId = routeResourceId ?? (typeof bodyResourceId === "string" && bodyResourceId.length <= 128 ? bodyResourceId : null);
    try {
      await database.query(
        `INSERT INTO audit_trail (
           user_id, action, resource_type, resource_id, request_id, outcome, details
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (request_id) DO NOTHING`,
        [
          request.actor?.userId ?? null,
          action,
          request.routeOptions.config.auditResourceType ?? null,
          resourceId,
          request.id,
          reply.statusCode < 400 ? "success" : "failure",
          JSON.stringify({ statusCode: reply.statusCode }),
        ],
      );
      return payload;
    } catch {
      request.log.error({ requestId: request.id }, "Audit trail write failed");
      reply.code(503);
      return JSON.stringify({
        error: {
          code: "AUDIT_UNAVAILABLE",
          message: "The action could not be recorded.",
        },
      });
    }
  });

  app.post<{ Body: LoginBody }>(
    "/auth/login",
    {
      config: {
        public: true,
        auditAction: "auth.login",
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
      schema: loginSchema,
    },
    async (request, reply) => {
      const result = await database.query<{
        user_id: string;
        username: string;
        role: string;
        chain_address: string | null;
        active: boolean;
        password_hash: string | null;
      }>(
        `SELECT user_id, username, role, chain_address, active, password_hash
         FROM users WHERE lower(username) = $1`,
        [request.body.username.trim().toLowerCase()],
      );
      const user = result.rows[0];
      const passwordMatches = await verifyPassword(
        request.body.password,
        user?.password_hash ?? DUMMY_PASSWORD_HASH,
      );
      if (!user || !passwordMatches || !user.active || !isRole(user.role)) {
        return sendError(reply, 401, "INVALID_CREDENTIALS", "Username or password is incorrect.");
      }

      return sendSession(reply, user);
    },
  );
  await registerAccountRoutes(app, database);
}

const DUMMY_PASSWORD_HASH =
  "scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  database: Pool,
): Promise<void> {
  try {
    const claims = await request.jwtVerify<{ sub: string; role: string }>();
    if (!claims.sub || !isRole(claims.role)) throw new Error("Invalid claims");
    const result = await database.query<{
      user_id: string;
      username: string;
      role: string;
      chain_address: string | null;
      active: boolean;
    }>(
      `SELECT user_id, username, role, chain_address, active
       FROM users WHERE user_id = $1`,
      [claims.sub],
    );
    const user = result.rows[0];
    if (!user || !user.active || !isRole(user.role) || user.role !== claims.role) {
      throw new Error("Inactive or changed user");
    }
    request.actor = {
      userId: user.user_id,
      username: user.username,
      role: user.role,
      chainAddress: user.chain_address,
    } satisfies AuthenticatedActor;
  } catch {
    sendError(reply, 401, "UNAUTHENTICATED", "A valid bearer token is required.");
  }
}

function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  return reply.code(status).send({ error: { code, message } });
}
