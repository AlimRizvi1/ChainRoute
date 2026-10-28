import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { FetchRequest, JsonRpcProvider } from "ethers";

const text = { type: "string", minLength: 1, maxLength: 128, pattern: "\\S" };
const positive = { type: "number", exclusiveMinimum: 0, maximum: 1e9, multipleOf: 0.001 };
const pageSchema = { type: "object", properties: {
  offset: { type: "integer", minimum: 0, maximum: 100000, default: 0 },
  limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
} };

export function registerPlatformRoutes(app: FastifyInstance, db: Pool, rpcUrl: string) {
  app.get("/planning/resources", { config: { permission: "orders.create" } }, async request => {
    const [carriers, wagons, routes] = await Promise.all([
      db.query(`SELECT username, chain_address AS address FROM users WHERE role='Carrier' AND active AND chain_address IS NOT NULL ORDER BY username`),
      db.query(`SELECT DISTINCT location, wagon_type AS "wagonType" FROM wagons WHERE active AND available ORDER BY location, wagon_type`),
      db.query(`SELECT DISTINCT origin, destination FROM routes WHERE active ORDER BY destination, origin`),
    ]);
    return { walletMapped: Boolean(request.actor!.chainAddress), carriers: carriers.rows, yards: wagons.rows, routes: routes.rows };
  });

  app.get<{ Querystring: { limit?: number; offset?: number } }>("/plans", {
    config: { permission: "plans.read" }, schema: { querystring: pageSchema },
  }, async request => {
    const offset = request.query.offset ?? 0, limit = request.query.limit ?? 25;
    const result = await db.query(`SELECT p.plan_id AS "planId", p.run_id AS "runId", p.created_at AS "createdAt",
      p.plan_payload->'metrics' AS metrics, jsonb_array_length(p.plan_payload->'assignments') AS "assignmentCount",
      c.contract_id AS "contractId", count(*) OVER()::int AS total
      FROM allocation_plans p LEFT JOIN contracts c ON c.plan_id=p.plan_id
      WHERE ($1='Administrator' OR p.created_by=$2::uuid)
      ORDER BY p.created_at DESC, p.plan_id DESC LIMIT $3 OFFSET $4`, [request.actor!.role, request.actor!.userId, limit, offset]);
    const total = result.rows[0]?.total ?? 0;
    return { items: result.rows.map(({ total: _total, ...row }) => row), total, nextOffset: offset + limit < total ? offset + limit : null };
  });

  app.get<{ Querystring: { limit?: number; offset?: number; outcome?: string; search?: string } }>("/audit", {
    config: { permission: "audit.read" }, schema: { querystring: { ...pageSchema, properties: {
      ...pageSchema.properties, outcome: { type: "string", enum: ["success", "failure"] }, search: { type: "string", maxLength: 128 },
    } } },
  }, async request => {
    const offset = request.query.offset ?? 0, limit = request.query.limit ?? 25;
    const result = await db.query(`SELECT a.audit_id::text AS id, coalesce(u.username,'Unauthenticated') AS actor,
      a.action, a.resource_type AS "resourceType", a.resource_id AS "resourceId", a.occurred_at AS "occurredAt",
      a.outcome, a.details->'statusCode' AS "statusCode", count(*) OVER()::int AS total
      FROM audit_trail a LEFT JOIN users u ON u.user_id=a.user_id
      WHERE ($1::text IS NULL OR a.outcome=$1) AND ($2='' OR a.action ILIKE '%' || $2 || '%' OR u.username ILIKE '%' || $2 || '%')
      ORDER BY a.audit_id DESC LIMIT $3 OFFSET $4`, [request.query.outcome ?? null, request.query.search ?? "", limit, offset]);
    const total = result.rows[0]?.total ?? 0;
    return { items: result.rows.map(({ total: _total, ...row }) => row), total, nextOffset: offset + limit < total ? offset + limit : null };
  });

  for (const kind of ["wagons", "routes"] as const) {
    const isWagon = kind === "wagons";
    const fields = isWagon
      ? { wagonId: text, capacityTonnes: positive, wagonType: text, location: text, available: { type: "boolean" }, active: { type: "boolean" } }
      : { routeId: text, origin: text, destination: text, distanceKm: positive, transitTimeSeconds: { type: "integer", minimum: 1, maximum: 2147483647 }, active: { type: "boolean" } };
    app.get(`/admin/${kind}`, { config: { permission: `admin.${kind}` } }, async () => {
      const result = await db.query(isWagon
        ? `SELECT wagon_id AS "wagonId", capacity_tonnes::float8 AS "capacityTonnes", wagon_type AS "wagonType", location, available, active FROM wagons ORDER BY wagon_id LIMIT 2000`
        : `SELECT route_id AS "routeId", origin, destination, distance_km::float8 AS "distanceKm", transit_time_seconds AS "transitTimeSeconds", active FROM routes ORDER BY route_id LIMIT 2000`);
      return { items: result.rows, limit: 2000 };
    });
    app.put<{ Body: Record<string, string | number | boolean> }>(`/admin/${kind}`, {
      config: { permission: `admin.${kind}`, auditAction: `admin.${kind}.save`, auditResourceType: isWagon ? "wagon" : "route" },
      schema: { body: { type: "object", additionalProperties: false, required: Object.keys(fields), properties: fields } },
    }, async (request, reply) => {
      const b = Object.fromEntries(Object.entries(request.body).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
      if (isWagon) await db.query(`INSERT INTO wagons(wagon_id,capacity_tonnes,wagon_type,location,available,active)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(wagon_id) DO UPDATE SET capacity_tonnes=$2,wagon_type=$3,location=$4,available=$5,active=$6,updated_at=now()`,
      [b.wagonId, b.capacityTonnes, b.wagonType, b.location, b.available, b.active]);
      else await db.query(`INSERT INTO routes(route_id,origin,destination,distance_km,transit_time_seconds,active)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(route_id) DO UPDATE SET origin=$2,destination=$3,distance_km=$4,transit_time_seconds=$5,active=$6,updated_at=now()`,
      [b.routeId, b.origin, b.destination, b.distanceKm, b.transitTimeSeconds, b.active]);
      return reply.send({ saved: true });
    });
    const idField = isWagon ? "wagonId" : "routeId", idColumn = isWagon ? "wagon_id" : "route_id";
    const columns = isWagon ? ["wagon_id", "capacity_tonnes", "wagon_type", "location", "available", "active"]
      : ["route_id", "origin", "destination", "distance_km", "transit_time_seconds", "active"];
    const keys = Object.keys(fields);
    const bodySchema = { type: "object", additionalProperties: false,
      required: keys.filter(key => key !== "active"), properties: { ...fields, active: { type: "boolean", default: true } } };
    app.post<{ Body: Record<string, string | number | boolean> }>(`/admin/${kind}`, {
      config: { permission: `admin.${kind}`, auditAction: `admin.${kind}.create`, auditResourceType: isWagon ? "wagon" : "route" },
      schema: { body: bodySchema },
    }, async (request, reply) => {
      const values = keys.map(key => typeof request.body[key] === "string" ? String(request.body[key]).trim() : request.body[key]);
      const result = await db.query(`INSERT INTO ${kind}(${columns.join(",")}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT(${idColumn}) DO NOTHING RETURNING ${idColumn}`, values);
      if (!result.rowCount) return reply.code(409).send({ error: { code: "RESOURCE_EXISTS", message: "This resource ID already exists. Edit the existing record instead." } });
      return reply.code(201).send({ ...request.body, active: request.body.active ?? true });
    });
    app.put<{ Body: Record<string, string | number | boolean>; Params: Record<string, string> }>(`/admin/${kind}/:${idField}`, {
      config: { permission: `admin.${kind}`, auditAction: `admin.${kind}.update`, auditResourceType: isWagon ? "wagon" : "route" },
      schema: { body: bodySchema },
    }, async (request, reply) => {
      if (request.params[idField] !== request.body[idField]) return reply.code(400).send({ error: { code: "RESOURCE_ID_MISMATCH", message: "The resource ID must match the path." } });
      const values = keys.map(key => typeof request.body[key] === "string" ? String(request.body[key]).trim() : request.body[key]);
      const result = await db.query(`UPDATE ${kind} SET ${columns.slice(1).map((column, i) => `${column}=$${i + 2}`).join(",")},updated_at=now() WHERE ${idColumn}=$1`, values);
      if (!result.rowCount) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Resource was not found." } });
      return request.body;
    });
    app.delete<{ Params: Record<string, string> }>(`/admin/${kind}/:${idField}`, {
      config: { permission: `admin.${kind}`, auditAction: `admin.${kind}.retire`, auditResourceType: isWagon ? "wagon" : "route" },
    }, async (request, reply) => {
      const result = await db.query(`UPDATE ${kind} SET active=false,updated_at=now() WHERE ${idColumn}=$1`, [request.params[idField]]);
      if (!result.rowCount) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Resource was not found." } });
      return reply.code(204).send();
    });
  }

  app.post<{ Params: { userId: string } }>("/admin/users/:userId/local-wallet", {
    config: { permission: "admin.users", auditAction: "admin.users.wallet", auditResourceType: "user" },
    schema: { params: { type: "object", required: ["userId"], properties: { userId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    const fail = (status: number, message: string) => reply.code(status).send({ error: { code: "WALLET_CONFIGURATION", message } });
    if (process.env.NODE_ENV === "production") return fail(409, "Local wallet provisioning is disabled in production. Configure a verified signing identity through deployment settings.");
    const rpc = new FetchRequest(rpcUrl); rpc.timeout = 5000;
    const provider = new JsonRpcProvider(rpc);
    const client = await db.connect();
    try {
      if ((await provider.getNetwork()).chainId !== 31337n) return fail(409, "Automatic provisioning is limited to the local development chain (31337).");
      const accounts = await provider.send("eth_accounts", []) as string[];
      await client.query("BEGIN");
      await client.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
      const user = (await client.query("SELECT role,chain_address FROM users WHERE user_id=$1 FOR UPDATE", [request.params.userId])).rows[0];
      if (!user) { await client.query("ROLLBACK"); return fail(404, "Account was not found."); }
      if (!["Shipper", "Carrier"].includes(user.role)) { await client.query("ROLLBACK"); return fail(409, "Only Shipper and Carrier accounts need a freight signing wallet."); }
      if (user.chain_address) { await client.query("ROLLBACK"); return { address: user.chain_address, walletMapped: true }; }
      if (process.env[`CHAIN_${user.role.toUpperCase()}_PRIVATE_KEY`]) { await client.query("ROLLBACK"); return fail(409, "A fixed role signer is configured. Provision its verified identity through deployment settings."); }
      const used = new Set((await client.query("SELECT lower(chain_address) AS address FROM users WHERE chain_address IS NOT NULL")).rows.map(row => row.address));
      const address = accounts.slice(4).find(value => !used.has(value.toLowerCase()));
      if (!address) { await client.query("ROLLBACK"); return fail(409, "All local wallets are assigned. Start the development node with more accounts."); }
      await client.query("UPDATE users SET chain_address=$1,updated_at=now() WHERE user_id=$2", [address, request.params.userId]);
      await client.query("COMMIT");
      return { address, walletMapped: true };
    } catch { await client.query("ROLLBACK").catch(() => undefined); return fail(503, "The local chain is unavailable. Start it and retry wallet provisioning."); }
    finally { client.release(); provider.destroy(); }
  });
}
