import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { ROLES } from "./authorization.js";
import { hashPassword } from "./password.js";
import { sendSession } from "./session.js";

type SignupInput = { username: string; password: string; invitationToken?: string };
const tokenProperty = { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" };
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const invalidInvitation = (reply: FastifyReply) => reply.code(400).send({ error: {
  code: "INVALID_INVITATION", message: "This invitation is invalid, expired, or already used. Ask an administrator for a new link.",
} });

export async function registerAccountRoutes(app: FastifyInstance, database: Pool) {
  app.post<{ Body: SignupInput }>("/auth/signup", {
    config: { public: true, auditAction: "auth.signup", auditResourceType: "user", rateLimit: { max: 5, timeWindow: "1 minute" } },
    schema: { body: {
      type: "object", additionalProperties: false, required: ["username", "password"],
      properties: {
        username: { type: "string", minLength: 3, maxLength: 64, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$" },
        password: { type: "string", minLength: 12, maxLength: 256 }, invitationToken: tokenProperty,
      },
    } },
  }, async (request, reply) => {
    if (Buffer.byteLength(request.body.password, "utf8") > 256 || !request.body.password.trim()) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Use a password of at least 12 characters and no more than 256 UTF-8 bytes.", fields: { password: "Password is too long or blank." } } });
    }
    const username = request.body.username.toLowerCase();
    const passwordHash = await hashPassword(request.body.password);
    const userId = randomUUID();
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      // Public registration has one role. An expiring, single-use invitation is
      // the only way a public request can receive another role.
      let role = "Shipper";
      let invitationId: string | undefined;
      if (request.body.invitationToken) {
        const result = await client.query<{ invitation_id: string; role: string }>(
          `SELECT invitation_id, role FROM account_invitations
           WHERE token_hash = $1 AND expires_at > now() AND used_at IS NULL AND revoked_at IS NULL
             AND EXISTS (SELECT 1 FROM users WHERE user_id = created_by AND active = true AND role = 'Administrator')
           FOR UPDATE`, [hashToken(request.body.invitationToken)],
        );
        if (!result.rows[0]) { await client.query("ROLLBACK"); return invalidInvitation(reply); }
        role = result.rows[0].role;
        invitationId = result.rows[0].invitation_id;
      }
      await client.query(
        "INSERT INTO users (user_id, username, role, password_hash) VALUES ($1, $2, $3, $4)",
        [userId, username, role, passwordHash],
      );
      if (invitationId) await client.query("UPDATE account_invitations SET used_by = $1, used_at = now() WHERE invitation_id = $2", [userId, invitationId]);
      await client.query("COMMIT");
      return sendSession(reply, { user_id: userId, username, role }, 201);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: { code: "USERNAME_UNAVAILABLE", message: "That username is unavailable. Choose another username or sign in." } });
      }
      throw error;
    } finally { client.release(); }
  });

  app.post<{ Body: { invitationToken: string } }>("/auth/invitations/preview", {
    config: { public: true, auditAction: "auth.invitation.preview", rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: { body: { type: "object", additionalProperties: false, required: ["invitationToken"], properties: { invitationToken: tokenProperty } } },
  }, async (request, reply) => {
    const result = await database.query(
      `SELECT role, expires_at AS "expiresAt" FROM account_invitations
       WHERE token_hash = $1 AND expires_at > now() AND used_at IS NULL AND revoked_at IS NULL
         AND EXISTS (SELECT 1 FROM users WHERE user_id = created_by AND active = true AND role = 'Administrator')`,
      [hashToken(request.body.invitationToken)],
    );
    return result.rows[0] ? reply.send(result.rows[0]) : invalidInvitation(reply);
  });

  app.get("/admin/users", { config: { permission: "admin.users" } }, async () => {
    const result = await database.query(`SELECT user_id AS id, username, role, active,
      (chain_address IS NOT NULL) AS "walletMapped", created_at AS "createdAt" FROM users ORDER BY created_at DESC, user_id LIMIT 200`);
    return { items: result.rows };
  });

  app.patch<{ Params: { userId: string }; Body: { active: boolean } }>("/admin/users/:userId", {
    config: { permission: "admin.users", auditAction: "admin.users.activation", auditResourceType: "user" },
    schema: {
      params: { type: "object", required: ["userId"], properties: { userId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["active"], properties: { active: { type: "boolean" } } },
    },
  }, async (request, reply) => {
    if (request.params.userId === request.actor!.userId && !request.body.active) {
      return reply.code(409).send({ error: { code: "SELF_DEACTIVATION", message: "You cannot disable your own administrator account." } });
    }
    const result = await database.query("UPDATE users SET active = $1, updated_at = now() WHERE user_id = $2 RETURNING user_id AS id, username, role, active", [request.body.active, request.params.userId]);
    return result.rows[0] ? reply.send(result.rows[0]) : reply.code(404).send({ error: { code: "NOT_FOUND", message: "Account was not found." } });
  });

  app.get("/admin/invitations", { config: { permission: "admin.users" } }, async () => {
    const result = await database.query(`SELECT invitation_id AS id, role, expires_at AS "expiresAt"
      FROM account_invitations WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 100`);
    return { items: result.rows };
  });

  app.post<{ Body: { role: string } }>("/admin/invitations", {
    config: { permission: "admin.users", auditAction: "admin.invitations.create", auditResourceType: "invitation", rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: { body: { type: "object", additionalProperties: false, required: ["role"], properties: { role: { type: "string", enum: [...ROLES] } } } },
  }, async (request, reply) => {
    const invitationToken = randomBytes(32).toString("base64url");
    const result = await database.query(`INSERT INTO account_invitations (invitation_id, token_hash, role, created_by, expires_at)
      VALUES ($1, $2, $3, $4, now() + interval '24 hours') RETURNING invitation_id AS id, role, expires_at AS "expiresAt"`,
    [randomUUID(), hashToken(invitationToken), request.body.role, request.actor!.userId]);
    reply.header("cache-control", "no-store");
    return reply.code(201).send({ ...result.rows[0], invitationToken });
  });

  app.delete<{ Params: { invitationId: string } }>("/admin/invitations/:invitationId", {
    config: { permission: "admin.users", auditAction: "admin.invitations.revoke", auditResourceType: "invitation" },
    schema: { params: { type: "object", required: ["invitationId"], properties: { invitationId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    await database.query("UPDATE account_invitations SET revoked_at = now() WHERE invitation_id = $1 AND used_at IS NULL", [request.params.invitationId]);
    return reply.code(204).send();
  });
}
