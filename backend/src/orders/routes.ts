import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { AuthenticatedActor } from "../auth/fastify.js";

type OrderInput = {
  cargoType: string;
  quantityTonnes: number;
  destination: string;
  priority: number;
  deadline: string;
};
type OptimizationInput = {
  weights: { onTime: number; cost: number; utilization: number };
  timeBudgetSeconds?: number;
  sourcePlanId?: string;
};
type OptimizationSnapshot = {
  planningStart?: string;
  orders: Array<Record<string, unknown>>;
  wagons: Array<Record<string, unknown>>;
  routes: Array<Record<string, unknown>>;
  weights: OptimizationInput["weights"];
  timeBudgetSeconds?: number;
};
type PlanPayload = {
  planId: string;
  runId: string;
  score: number;
  assignments: Array<Record<string, unknown> & { orderId: string }>;
  unassignedOrders: Array<{ orderId: string }>;
  runMetadata: Record<string, unknown> & { durationMs: number; generatedAt: string; inputHash: string };
};
type PendingOrder = {
  order_id: string;
  cargo_type: string;
  quantity_tonnes: string;
  destination: string;
  priority: number;
  deadline: Date;
};

const orderSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["cargoType", "quantityTonnes", "destination", "priority", "deadline"],
    properties: {
      cargoType: { type: "string", minLength: 1, maxLength: 128 },
      quantityTonnes: { type: "number", exclusiveMinimum: 0, maximum: 999999999999999, multipleOf: 0.001 },
      destination: { type: "string", minLength: 1, maxLength: 256 },
      priority: { type: "integer", minimum: 1, maximum: 3 },
      deadline: { type: "string", format: "date-time" },
    },
  },
};
const optimizationSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["weights"],
    properties: {
      weights: {
        type: "object",
        additionalProperties: false,
        required: ["onTime", "cost", "utilization"],
        properties: {
          onTime: { type: "number", minimum: 0 },
          cost: { type: "number", minimum: 0 },
          utilization: { type: "number", minimum: 0 },
        },
      },
      timeBudgetSeconds: { type: "number", minimum: 0.05, maximum: 10 },
      sourcePlanId: { type: "string", minLength: 1, maxLength: 128 },
    },
  },
};

export async function registerOrderRoutes(
  app: FastifyInstance,
  database: Pool,
  aiEngineUrl: string,
  optimizationTimeoutMs: number,
): Promise<void> {
  app.get<{ Querystring: { status?: string; limit?: number; offset?: number } }>(
    "/orders",
    { config: { permission: "orders.create" }, schema: { querystring: {
      type: "object", additionalProperties: false, properties: {
        status: { type: "string", enum: ["Pending", "Planned"] },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        offset: { type: "integer", minimum: 0, maximum: 100000, default: 0 },
      },
    } } },
    async (request, reply) => {
      const actor = request.actor!;
      const limit = request.query.limit ?? 50;
      const offset = request.query.offset ?? 0;
      const result = await database.query(
        `SELECT order_id, cargo_type, quantity_tonnes::float8, destination, priority, deadline, status, created_at,
                count(*) OVER()::int AS total
         FROM orders WHERE ($1::text = 'Administrator' OR created_by = $2::uuid)
           AND ($3::text IS NULL OR status = $3)
         ORDER BY created_at DESC, order_id DESC LIMIT $4 OFFSET $5`,
        [actor.role, actor.userId, request.query.status ?? null, limit, offset],
      );
      const total = result.rows[0]?.total ?? 0;
      return reply.code(200).send({ items: result.rows.map((row) => ({
        orderId: row.order_id, cargoType: row.cargo_type, quantityTonnes: row.quantity_tonnes,
        destination: row.destination, priority: row.priority, deadline: row.deadline.toISOString(),
        status: row.status, createdAt: row.created_at.toISOString(),
      })), total, nextOffset: offset + result.rows.length < total ? offset + limit : null });
    },
  );

  app.post<{ Body: OrderInput }>(
    "/orders",
    {
      config: { permission: "orders.create", auditAction: "orders.create", auditResourceType: "order" },
      schema: orderSchema,
    },
    async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) return;
      const { cargoType, quantityTonnes, destination, priority, deadline } = request.body;
      const fields: Record<string, string> = {};
      if (!cargoType.trim()) fields.cargoType = "Must not be blank.";
      if (!destination.trim()) fields.destination = "Must not be blank.";
      if (new Date(deadline).getTime() <= Date.now()) fields.deadline = "Must be in the future.";
      if (Object.keys(fields).length) {
        return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Order fields are invalid.", fields } });
      }
      const orderId = `ord_${randomUUID().replaceAll("-", "")}`;
      await database.query(
        `INSERT INTO orders (order_id, created_by, cargo_type, quantity_tonnes, destination, priority, deadline)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [orderId, actor.userId, cargoType.trim(), quantityTonnes, destination.trim(), priority, deadline],
      );
      return reply.code(201).send({ orderId, status: "Pending" });
    },
  );

  app.post<{ Body: OptimizationInput }>(
    "/optimizations/run",
    {
      config: { permission: "optimizations.run", auditAction: "optimizations.run", auditResourceType: "optimization_run" },
      schema: optimizationSchema,
    },
    async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) return;
      let sourcePlanId: string | null = null;
      let scenarioGroupId: string | null = null;
      let planOwnerId = actor.userId;
      let baseSnapshot: OptimizationSnapshot;

      if (request.body.sourcePlanId) {
        const sourceResult = actor.role === "Administrator"
          ? await database.query<{ created_by: string; scenario_group_id: string; input_snapshot: unknown }>(
              `SELECT p.created_by, p.scenario_group_id, r.input_snapshot
               FROM allocation_plans p JOIN optimization_runs r ON r.run_id = p.run_id
               WHERE p.plan_id = $1`,
              [request.body.sourcePlanId],
            )
          : await database.query<{ created_by: string; scenario_group_id: string; input_snapshot: unknown }>(
              `SELECT p.created_by, p.scenario_group_id, r.input_snapshot
               FROM allocation_plans p JOIN optimization_runs r ON r.run_id = p.run_id
               WHERE p.plan_id = $1 AND p.created_by = $2`,
              [request.body.sourcePlanId, actor.userId],
            );
        const source = sourceResult.rows[0];
        if (!source) return sendError(reply, 404, "NOT_FOUND", "Source plan was not found.");

        const activity = await database.query(
          `SELECT EXISTS (SELECT 1 FROM contracts WHERE scenario_group_id = $1)
                    OR EXISTS (SELECT 1 FROM contract_operations
                               WHERE scenario_group_id = $1 AND action = 'accept'
                                 AND status IN ('pending', 'queued', 'processing')) AS locked`,
          [source.scenario_group_id],
        );
        if (activity.rows[0]?.locked) {
          return sendError(reply, 409, "SCENARIO_ALREADY_ACCEPTED", "This plan set is already being accepted or has a contract.");
        }

        const snapshot = readOptimizationSnapshot(source.input_snapshot);
        if (!snapshot) return sendError(reply, 409, "PLAN_INPUT_UNAVAILABLE", "This saved plan has no usable optimization input snapshot.");
        baseSnapshot = snapshot;
        sourcePlanId = request.body.sourcePlanId;
        scenarioGroupId = source.scenario_group_id;
        planOwnerId = source.created_by;
      } else {
        const ordersResult = actor.role === "Administrator"
          ? await database.query<PendingOrder>(
              `SELECT order_id, cargo_type, quantity_tonnes::text, destination, priority, deadline
               FROM orders WHERE status = 'Pending' ORDER BY created_at, order_id`,
            )
          : await database.query<PendingOrder>(
              `SELECT order_id, cargo_type, quantity_tonnes::text, destination, priority, deadline
               FROM orders WHERE status = 'Pending' AND created_by = $1 ORDER BY created_at, order_id`,
              [actor.userId],
            );
        if (ordersResult.rowCount === 0) {
          return reply.code(200).send({ status: "empty", message: "There are no pending orders to optimize.", plan: null });
        }

        const [wagonsResult, routesResult] = await Promise.all([
          database.query(
            `SELECT wagon_id AS "wagonId", capacity_tonnes AS "capacityTonnes", wagon_type AS "wagonType", location, available
             FROM wagons WHERE active = true AND available = true ORDER BY wagon_id`,
          ),
          database.query(
            `SELECT route_id AS "routeId", origin, destination, distance_km AS "distanceKm", transit_time_seconds AS "transitTimeSeconds"
             FROM routes WHERE active = true ORDER BY route_id`,
          ),
        ]);
        baseSnapshot = {
          orders: ordersResult.rows.map((order) => ({
            orderId: order.order_id,
            cargoType: order.cargo_type,
            quantityTonnes: Number(order.quantity_tonnes),
            destination: order.destination,
            priority: order.priority,
            deadline: order.deadline.toISOString(),
          })),
          wagons: wagonsResult.rows.map((wagon) => ({ ...wagon, capacityTonnes: Number(wagon.capacityTonnes) })),
          routes: routesResult.rows.map((route) => ({ ...route, distanceKm: Number(route.distanceKm) })),
          weights: request.body.weights,
          timeBudgetSeconds: request.body.timeBudgetSeconds ?? 1,
          planningStart: new Date().toISOString(),
        };
      }

      const upstreamRequest = {
        ...baseSnapshot,
        weights: request.body.weights,
        timeBudgetSeconds: request.body.timeBudgetSeconds ?? baseSnapshot.timeBudgetSeconds ?? 1,
      };

      let response: Response;
      try {
        response = await fetch(`${aiEngineUrl}/v1/optimize`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(upstreamRequest),
          signal: AbortSignal.timeout(optimizationTimeoutMs),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          return sendError(reply, 504, "AI_ENGINE_TIMEOUT", "The optimization service timed out.");
        }
        return sendError(reply, 503, "AI_ENGINE_UNAVAILABLE", "The optimization service is unavailable.");
      }
      if (!response.ok) return sendError(reply, 503, "AI_ENGINE_UNAVAILABLE", "The optimization service is unavailable.");

      let plan: PlanPayload;
      let outputIds: string[];
      try {
        const raw: unknown = await response.json();
        if (!isPlanPayload(raw)) throw new Error("Response does not match the plan contract.");
        const inputIds = new Set(baseSnapshot.orders.map((order) => order.orderId));
        outputIds = [...raw.assignments.map((item) => item.orderId), ...raw.unassignedOrders.map((item) => item.orderId)];
        if (new Set(outputIds).size !== outputIds.length || outputIds.length !== inputIds.size || outputIds.some((id) => !inputIds.has(id))) {
          throw new Error("Response order set does not match the submitted snapshot.");
        }
        plan = raw;
      } catch {
        return sendError(reply, 502, "AI_ENGINE_INVALID_RESPONSE", "The optimization service returned an invalid plan.");
      }

      const client = await database.connect();
      try {
        await client.query("BEGIN");
        if (scenarioGroupId) {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [scenarioGroupId]);
          const activity = await client.query(
            `SELECT EXISTS (SELECT 1 FROM contracts WHERE scenario_group_id = $1)
                      OR EXISTS (SELECT 1 FROM contract_operations
                                 WHERE scenario_group_id = $1 AND action = 'accept'
                                   AND status IN ('pending', 'queued', 'processing')) AS locked`,
            [scenarioGroupId],
          );
          if (activity.rows[0]?.locked) {
            await client.query("ROLLBACK");
            return sendError(reply, 409, "SCENARIO_ALREADY_ACCEPTED", "This plan set is already being accepted or has a contract.");
          }
        }
        await client.query(
          `INSERT INTO optimization_runs (run_id, input_hash, status, input_snapshot, run_metadata, duration_ms, completed_at)
           VALUES ($1, $2, 'succeeded', $3::jsonb, $4::jsonb, $5, $6)`,
          [plan.runId, getInputHash(plan), JSON.stringify(upstreamRequest), JSON.stringify(plan.runMetadata), plan.runMetadata.durationMs, plan.runMetadata.generatedAt],
        );
        await client.query(
          `INSERT INTO allocation_plans (plan_id, run_id, created_by, plan_payload, score, scenario_group_id, source_plan_id)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
          [plan.planId, plan.runId, planOwnerId, JSON.stringify(plan), plan.score, scenarioGroupId ?? plan.planId, sourcePlanId],
        );
        for (const orderId of outputIds) {
          await client.query(
            `INSERT INTO plan_orders (plan_id, order_id, assigned) VALUES ($1, $2, $3)`,
            [plan.planId, orderId, plan.assignments.some((assignment) => assignment.orderId === orderId)],
          );
        }
        if (!sourcePlanId) {
          const lockResult = await client.query(
            `UPDATE orders SET status = 'Planned', locked_at = now(), updated_at = now()
             WHERE order_id = ANY($1::text[]) AND status = 'Pending'`,
            [outputIds],
          );
          if (lockResult.rowCount !== outputIds.length) throw new Error("Pending order set changed during optimization.");
        }
        await client.query("COMMIT");
        return reply.code(200).send(plan);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        request.log.warn({ err: error }, "Could not persist optimization plan");
        return sendError(reply, 409, "ORDERS_CHANGED", "Pending orders changed while the plan was being generated. Retry optimization.");
      } finally {
        client.release();
      }
    },
  );

  app.get<{ Params: { planId: string } }>(
    "/plans/:planId",
    { config: { permission: "plans.read" } },
    async (request, reply) => {
      const row = await getOwnedPlan(database, request.params.planId, request.actor!);
      if (!row) return sendError(reply, 404, "NOT_FOUND", "Plan was not found.");
      return reply.code(200).send(row.plan_payload);
    },
  );

  app.get<{ Params: { planId: string }; Querystring: { format: string } }>(
    "/plans/:planId/export",
    { config: { permission: "plans.export" }, schema: { querystring: {
      type: "object", additionalProperties: false, required: ["format"], properties: { format: { type: "string", enum: ["json", "csv"] } },
    } } },
    async (request, reply) => {
      const row = await getOwnedPlan(database, request.params.planId, request.actor!);
      if (!row) return sendError(reply, 404, "NOT_FOUND", "Plan was not found.");
      if (request.query.format === "json") return reply.code(200).type("application/json").send(row.plan_payload);
      const plan = row.plan_payload as PlanPayload & { assignments: Array<Record<string, unknown>> };
      const header = ["planId", "runId", "orderId", "cargoType", "quantityTonnes", "wagonIds", "routeId", "origin", "destination", "departAt", "eta", "onTimeProbability", "score"];
      const rows = plan.assignments.map((assignment) => {
        const route = assignment.route as Record<string, unknown>;
        return [plan.planId, plan.runId, assignment.orderId, assignment.cargoType, assignment.quantityTonnes,
          Array.isArray(assignment.wagonIds) ? assignment.wagonIds.join(";") : "", route.routeId, route.origin, route.destination,
          assignment.departAt, assignment.eta, assignment.onTimeProbability, assignment.score];
      });
      const csv = [header, ...rows].map((values) => values.map(csvCell).join(",")).join("\r\n");
      return reply.code(200).header("content-disposition", `attachment; filename="${safeFilename(plan.planId)}.csv"`).type("text/csv; charset=utf-8").send(csv);
    },
  );
}

function readOptimizationSnapshot(value: unknown): OptimizationSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const snapshot = value as Partial<OptimizationSnapshot>;
  if (!Array.isArray(snapshot.orders) || !snapshot.orders.length ||
      !Array.isArray(snapshot.wagons) || !Array.isArray(snapshot.routes) ||
      !snapshot.weights || typeof snapshot.weights !== "object") return undefined;
  return snapshot as OptimizationSnapshot;
}

async function getOwnedPlan(database: Pool, planId: string, actor: AuthenticatedActor): Promise<{ plan_payload: unknown } | undefined> {
  const result = actor.role === "Administrator"
    ? await database.query<{ plan_payload: unknown }>("SELECT plan_payload FROM allocation_plans WHERE plan_id = $1", [planId])
    : await database.query<{ plan_payload: unknown }>("SELECT plan_payload FROM allocation_plans WHERE plan_id = $1 AND created_by = $2", [planId, actor.userId]);
  return result.rows[0];
}

function requireActor(request: FastifyRequest, reply: FastifyReply): AuthenticatedActor | undefined {
  if (request.actor) return request.actor;
  sendError(reply, 401, "UNAUTHENTICATED", "A valid bearer token is required.");
  return undefined;
}

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function isPlanPayload(value: unknown): value is PlanPayload {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  const metadata = plan.runMetadata as Record<string, unknown> | undefined;
  return typeof plan.planId === "string" && plan.planId.length > 0 &&
    typeof plan.runId === "string" && plan.runId.length > 0 &&
    typeof plan.score === "number" && Number.isFinite(plan.score) && plan.score >= 0 &&
    isMetrics(plan.metrics) &&
    Array.isArray(plan.assignments) && plan.assignments.every(isAssignment) &&
    Array.isArray(plan.unassignedOrders) && plan.unassignedOrders.every(isUnassignedOrder) &&
    Array.isArray(plan.alternatives) && plan.alternatives.every(isAlternative) &&
    !!metadata && typeof metadata.generatedAt === "string" && Number.isFinite(Date.parse(metadata.generatedAt)) &&
    typeof metadata.durationMs === "number" && Number.isInteger(metadata.durationMs) && metadata.durationMs >= 0 &&
    typeof metadata.algorithm === "string" && metadata.algorithm.length > 0 && isWeights(metadata.weights) &&
    typeof metadata.inputHash === "string" && /^sha256:[0-9a-f]{64}$/.test(metadata.inputHash) &&
    isInputCounts(metadata.inputCounts) && isPrediction(metadata.prediction);
}

function isOrderRef(value: unknown): value is { orderId: string } {
  return !!value && typeof value === "object" && typeof (value as { orderId?: unknown }).orderId === "string" &&
    (value as { orderId: string }).orderId.length > 0;
}

function isAssignment(value: unknown): boolean {
  if (!isOrderRef(value)) return false;
  const item = value as Record<string, unknown>;
  const route = item.route as Record<string, unknown> | undefined;
  return typeof item.cargoType === "string" && Array.isArray(item.wagonIds) && item.wagonIds.length > 0 &&
    item.wagonIds.every((id) => typeof id === "string" && id.length > 0) && !!route &&
    typeof route.routeId === "string" && typeof route.origin === "string" && typeof route.destination === "string" &&
    typeof item.quantityTonnes === "number" && Number.isFinite(item.quantityTonnes) && item.quantityTonnes > 0 &&
    typeof item.departAt === "string" && Number.isFinite(Date.parse(item.departAt)) &&
    typeof item.eta === "string" && Number.isFinite(Date.parse(item.eta)) &&
    typeof item.onTimeProbability === "number" && item.onTimeProbability >= 0 && item.onTimeProbability <= 1 &&
    typeof item.score === "number" && Number.isFinite(item.score);
}

function isMetrics(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const metrics = value as Record<string, unknown>;
  return typeof metrics.utilizationPercent === "number" && metrics.utilizationPercent >= 0 && metrics.utilizationPercent <= 100 &&
    typeof metrics.estimatedCostPaise === "string" && /^[0-9]+$/.test(metrics.estimatedCostPaise) &&
    typeof metrics.distanceKm === "number" && metrics.distanceKm >= 0 &&
    typeof metrics.onTimeProbability === "number" && metrics.onTimeProbability >= 0 && metrics.onTimeProbability <= 1;
}

function isWeights(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const weights = value as Record<string, unknown>;
  return [weights.onTime, weights.cost, weights.utilization].every((weight) =>
    typeof weight === "number" && Number.isFinite(weight) && weight >= 0);
}

function isInputCounts(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const counts = value as Record<string, unknown>;
  return [counts.orders, counts.wagons, counts.routes].every((count) =>
    typeof count === "number" && Number.isInteger(count) && count >= 0);
}

function isPrediction(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const prediction = value as Record<string, unknown>;
  return ["logistic_regression", "heuristic_fallback", "mixed"].includes(String(prediction.method)) &&
    (prediction.modelVersion === null || typeof prediction.modelVersion === "string");
}

function isUnassignedOrder(value: unknown): boolean {
  if (!isOrderRef(value)) return false;
  const item = value as Record<string, unknown>;
  return ["NO_COMPATIBLE_WAGON", "INCOMPATIBLE_WAGON_TYPE", "NO_ROUTE", "INSUFFICIENT_CAPACITY", "NO_FEASIBLE_ASSIGNMENT", "TIME_BUDGET_EXCEEDED"].includes(String(item.reasonCode)) &&
    typeof item.message === "string" && item.message.length > 0;
}

function isAlternative(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.rank === "number" && Number.isInteger(item.rank) && item.rank >= 1 &&
    typeof item.score === "number" && Number.isFinite(item.score) && item.score >= 0 &&
    Array.isArray(item.assignments) && item.assignments.every(isAssignment) && isMetrics(item.metrics);
}

function getInputHash(plan: PlanPayload): string {
  const metadata = (plan as PlanPayload & { runMetadata?: { inputHash?: unknown } }).runMetadata;
  if (!metadata || typeof metadata.inputHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(metadata.inputHash)) {
    throw new Error("Optimization response is missing a valid input hash.");
  }
  return metadata.inputHash;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "allocation-plan";
}
