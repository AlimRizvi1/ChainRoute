const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { randomUUID, randomBytes } = require("node:crypto");
const { resolve } = require("node:path");
const { after, test } = require("node:test");
const { Pool } = require("pg");

const { createPlatformApp } = require("../dist/app.js");
const { runMigrations } = require("../dist/db/migrations.js");
const { seedDemoData } = require("../dist/db/seed.js");

const databaseUrl = process.env.TEST_DATABASE_URL;
let app;
let liveApp;
let pool;
let schema;
let stub;
let stubUrl;

test(
  "order intake, AI optimization persistence, ownership, exports, and immutable planned orders",
  { skip: !databaseUrl && "Set TEST_DATABASE_URL to a dedicated local ChainRoute PostgreSQL database." },
  async () => {
    process.env.DEMO_USER_PASSWORD = randomBytes(24).toString("base64url");
    schema = `phase17_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
    const setupPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await setupPool.query(`CREATE SCHEMA ${schema}`);
    await setupPool.end();
    pool = new Pool({ connectionString: databaseUrl, max: 2, options: `-c search_path=${schema},public` });
    await runMigrations(pool);
    await seedDemoData(pool, resolve(__dirname, "../../samples/plentiful-dataset.json"));

    let responseMode = "success";
    let upstreamCalls = 0;
    stub = createServer(async (request, response) => {
      if (request.url !== "/v1/optimize") {
        response.writeHead(404).end();
        return;
      }
      upstreamCalls += 1;
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      if (responseMode === "unavailable") {
        response.writeHead(503).end("unavailable");
      } else if (responseMode === "timeout") {
        setTimeout(() => response.writeHead(200, { "content-type": "application/json" }).end("{}"), 600);
      } else if (responseMode === "malformed") {
        response.writeHead(200, { "content-type": "application/json" }).end("{bad json");
      } else {
        const order = input.orders[0];
        const plan = {
          planId: `plan_${randomUUID().replaceAll("-", "")}`,
          runId: `run_${randomUUID().replaceAll("-", "")}`,
          score: 0.75,
          assignments: input.orders.map((order) => ({
            orderId: order.orderId,
            cargoType: order.cargoType,
            wagonIds: [input.wagons[0].wagonId],
            route: { routeId: input.routes[0].routeId, origin: input.routes[0].origin, destination: order.destination },
            quantityTonnes: order.quantityTonnes,
            departAt: new Date().toISOString(),
            eta: new Date(Date.now() + 60_000).toISOString(),
            onTimeProbability: 0.95,
            score: 0.75,
          })),
          metrics: { utilizationPercent: 80, estimatedCostPaise: "100", distanceKm: 10, onTimeProbability: 0.95 },
          unassignedOrders: [],
          alternatives: [],
          runMetadata: {
            generatedAt: new Date().toISOString(), durationMs: 3, algorithm: "test", weights: input.weights,
            inputHash: `sha256:${"a".repeat(64)}`, inputCounts: { orders: input.orders.length, wagons: input.wagons.length, routes: input.routes.length },
            prediction: { method: "heuristic_fallback", modelVersion: null },
          },
        };
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(plan));
      }
    });
    await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
    stubUrl = `http://127.0.0.1:${stub.address().port}`;
    app = await createPlatformApp({
      database: pool,
      tokenSecret: randomBytes(32).toString("base64url"),
      aiEngineUrl: stubUrl,
      dependencyTimeoutMs: 100,
      optimizationTimeoutMs: 500,
      logger: false,
    });
    const shipper = await pool.query("SELECT user_id FROM users WHERE username = 'demo.shipper'");
    const carrier = await pool.query("SELECT user_id FROM users WHERE username = 'demo.carrier'");
    const shipperToken = app.jwt.sign({ sub: shipper.rows[0].user_id, role: "Shipper" });
    const carrierToken = app.jwt.sign({ sub: carrier.rows[0].user_id, role: "Carrier" });
    const headers = { authorization: `Bearer ${shipperToken}` };
    const initialSummary = await app.inject({ method: "GET", url: "/dashboard/summary", headers });
    assert.equal(initialSummary.statusCode, 200, initialSummary.body);
    assert.equal(initialSummary.json().pendingOrders, 0);
    assert.equal(initialSummary.json().utilizationTrend.length, 7);
    assert.equal((await app.inject({ method: "GET", url: "/dashboard/summary", headers: { authorization: `Bearer ${carrierToken}` } })).statusCode, 403);

    const invalid = await app.inject({ method: "POST", url: "/orders", headers, payload: {
      cargoType: "Coal", quantityTonnes: -1, destination: "North", priority: 2, deadline: new Date(Date.now() + 3600_000).toISOString(),
    } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, "VALIDATION_ERROR");
    assert.ok(invalid.json().error.fields);
    assert.equal((await app.inject({ method: "GET", url: "/plans/nope", headers: { authorization: `Bearer ${carrierToken}` } })).statusCode, 403);

    const created = await app.inject({ method: "POST", url: "/orders", headers, payload: {
      cargoType: "Coal", quantityTonnes: 40, destination: "New Delhi", priority: 2,
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
    } });
    assert.equal(created.statusCode, 201);
    const orderId = created.json().orderId;
    assert.equal(created.json().status, "Pending");
    assert.equal((await app.inject({ method: "GET", url: "/dashboard/summary", headers })).json().pendingOrders, 1);

    const noWeights = await app.inject({ method: "POST", url: "/optimizations/run", headers, payload: { weights: { onTime: -1, cost: 1, utilization: 1 } } });
    assert.equal(noWeights.statusCode, 400);
    assert.equal(upstreamCalls, 0);

    responseMode = "malformed";
    const malformed = await app.inject({ method: "POST", url: "/optimizations/run", headers, payload: { weights: { onTime: 1, cost: 1, utilization: 1 } } });
    assert.equal(malformed.statusCode, 502);
    assert.equal((await pool.query("SELECT status FROM orders WHERE order_id = $1", [orderId])).rows[0].status, "Pending");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM allocation_plans")).rows[0].count, 0);

    responseMode = "unavailable";
    const unavailable = await app.inject({ method: "POST", url: "/optimizations/run", headers, payload: { weights: { onTime: 1, cost: 1, utilization: 1 } } });
    assert.equal(unavailable.statusCode, 503);
    responseMode = "timeout";
    const timedOut = await app.inject({ method: "POST", url: "/optimizations/run", headers, payload: { weights: { onTime: 1, cost: 1, utilization: 1 } } });
    assert.equal(timedOut.statusCode, 504);
    const secondOrder = await app.inject({ method: "POST", url: "/orders", headers, payload: {
      cargoType: "Coal", quantityTonnes: 20, destination: "Mumbai", priority: 1,
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
    } });
    assert.equal(secondOrder.statusCode, 201, "order intake works while Track 1 is unavailable");

    responseMode = "success";
    const optimized = await app.inject({ method: "POST", url: "/optimizations/run", headers, payload: { weights: { onTime: 1, cost: 1, utilization: 1 } } });
    assert.equal(optimized.statusCode, 200, optimized.body);
    const plan = optimized.json();
    assert.equal(plan.assignments.length, 2);
    assert.equal((await pool.query("SELECT status, locked_at FROM orders WHERE order_id = $1", [plan.assignments[0].orderId])).rows[0].status, "Planned");
    await assert.rejects(() => pool.query("UPDATE orders SET destination = 'Changed' WHERE order_id = $1", [plan.assignments[0].orderId]));
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM optimization_runs WHERE run_id = $1", [plan.runId])).rows[0].count, 1);

    const alternative = await app.inject({ method: "POST", url: "/optimizations/run", headers, payload: {
      weights: { onTime: 0, cost: 1, utilization: 0 }, sourcePlanId: plan.planId,
    } });
    assert.equal(alternative.statusCode, 200, alternative.body);
    const alternativePlan = alternative.json();
    assert.notEqual(alternativePlan.planId, plan.planId);
    assert.equal((await pool.query("SELECT source_plan_id FROM allocation_plans WHERE plan_id = $1", [alternativePlan.planId])).rows[0].source_plan_id, plan.planId);
    const scenarioPlans = await pool.query("SELECT scenario_group_id FROM allocation_plans WHERE plan_id = ANY($1::text[]) ORDER BY plan_id", [[plan.planId, alternativePlan.planId]]);
    assert.equal(scenarioPlans.rowCount, 2);
    assert.equal(scenarioPlans.rows[0].scenario_group_id, scenarioPlans.rows[1].scenario_group_id);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM plan_orders WHERE order_id = $1", [orderId])).rows[0].count, 2);
    assert.equal((await pool.query("SELECT status FROM orders WHERE order_id = $1", [orderId])).rows[0].status, "Planned");
    const childSnapshot = await pool.query("SELECT input_snapshot FROM optimization_runs WHERE run_id = $1", [alternativePlan.runId]);
    assert.deepEqual(childSnapshot.rows[0].input_snapshot.orders.map((order) => order.orderId).sort(), [orderId, secondOrder.json().orderId].sort());
    assert.deepEqual(childSnapshot.rows[0].input_snapshot.weights, { onTime: 0, cost: 1, utilization: 0 });

    const inaccessibleSource = await app.inject({ method: "POST", url: "/optimizations/run", headers, payload: {
      weights: { onTime: 1, cost: 0, utilization: 0 }, sourcePlanId: "missing-plan",
    } });
    assert.equal(inaccessibleSource.statusCode, 404);

    await pool.query(
      `INSERT INTO contract_operations (operation_id, plan_id, action, idempotency_key, request_hash, status, request_payload, actor_user_id, scenario_group_id)
       SELECT $1, $2, 'accept', 'test-active-accept', $3, 'pending', '{}'::jsonb, $4, scenario_group_id
       FROM allocation_plans WHERE plan_id = $2`,
      [randomUUID(), plan.planId, "a".repeat(64), shipper.rows[0].user_id],
    );
    const blockedWhatIf = await app.inject({ method: "POST", url: "/optimizations/run", headers, payload: {
      weights: { onTime: 1, cost: 0, utilization: 0 }, sourcePlanId: alternativePlan.planId,
    } });
    assert.equal(blockedWhatIf.statusCode, 409);
    assert.equal(blockedWhatIf.json().error.code, "SCENARIO_ALREADY_ACCEPTED");

    const fetched = await app.inject({ method: "GET", url: `/plans/${plan.planId}`, headers });
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.json().runId, plan.runId);
    const hidden = await app.inject({ method: "GET", url: `/plans/${plan.planId}`, headers: { authorization: `Bearer ${carrierToken}` } });
    assert.equal(hidden.statusCode, 403);
    const exportedJson = await app.inject({ method: "GET", url: `/plans/${plan.planId}/export?format=json`, headers });
    assert.equal(exportedJson.statusCode, 200);
    const exportedCsv = await app.inject({ method: "GET", url: `/plans/${plan.planId}/export?format=csv`, headers });
    assert.equal(exportedCsv.statusCode, 200);
    assert.match(exportedCsv.headers["content-type"], /text\/csv/);
    assert.match(exportedCsv.body, /orderId/);
    assert.match(exportedCsv.body, new RegExp(orderId));

    if (process.env.LIVE_AI_ENGINE_URL) {
      const livePool = new Pool({ connectionString: databaseUrl, max: 2, options: `-c search_path=${schema},public` });
      liveApp = await createPlatformApp({
        database: livePool,
        tokenSecret: randomBytes(32).toString("base64url"),
        aiEngineUrl: process.env.LIVE_AI_ENGINE_URL,
        dependencyTimeoutMs: 60_000,
        logger: false,
      });
      const liveToken = liveApp.jwt.sign({ sub: shipper.rows[0].user_id, role: "Shipper" });
      const liveHeaders = { authorization: `Bearer ${liveToken}` };
      const liveOrder = await liveApp.inject({ method: "POST", url: "/orders", headers: liveHeaders, payload: {
        cargoType: "Coal", quantityTonnes: 40, destination: "New Delhi", priority: 2,
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
      } });
      assert.equal(liveOrder.statusCode, 201);
      const livePlan = await liveApp.inject({ method: "POST", url: "/optimizations/run", headers: liveHeaders, payload: {
        weights: { onTime: 1, cost: 1, utilization: 1 }, timeBudgetSeconds: 0.05,
      } });
      assert.equal(livePlan.statusCode, 200, livePlan.body);
      assert.equal(livePlan.json().assignments.length + livePlan.json().unassignedOrders.length, 1);
    }

    const empty = await app.inject({ method: "POST", url: "/optimizations/run", headers, payload: { weights: { onTime: 1, cost: 1, utilization: 1 } } });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json(), { status: "empty", message: "There are no pending orders to optimize.", plan: null });
  },
);

after(async () => {
  if (liveApp) await liveApp.close();
  if (app) await app.close();
  if (stub) await new Promise((resolve) => stub.close(resolve));
  if (databaseUrl && schema) {
    const cleanupPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await cleanupPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await cleanupPool.end();
  }
});
