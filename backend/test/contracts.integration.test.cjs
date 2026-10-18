const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { after, test } = require("node:test");
const { Pool } = require("pg");
const { JsonRpcProvider, Contract } = require("ethers");
const WebSocket = require("ws");

const { createPlatformApp } = require("../dist/app.js");
const { reconcileContract } = require("../dist/contracts/sync.js");
const { runMigrations } = require("../dist/db/migrations.js");
const { seedDemoData } = require("../dist/db/seed.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const chainRpcUrl = process.env.LIVE_CHAIN_RPC_URL;
const artifactPath = process.env.LIVE_CONTRACT_PATH;
let app;
let queueApp;
let pool;
let schema;
let provider;
let settlement;
const sockets = [];

test(
  "HTTP contract lifecycle is idempotent and matches the real Track 2 vector F settlement",
  { skip: !(databaseUrl && chainRpcUrl && artifactPath) && "Set TEST_DATABASE_URL, LIVE_CHAIN_RPC_URL, and LIVE_CONTRACT_PATH for live contract integration." },
  async () => {
    process.env.DEMO_USER_PASSWORD = randomBytes(24).toString("base64url");
    schema = `phase18_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
    const setupPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await setupPool.query(`CREATE SCHEMA ${schema}`);
    await setupPool.end();
    pool = new Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${schema},public` });
    await runMigrations(pool);
    await seedDemoData(pool, require("node:path").resolve(__dirname, "../../samples/plentiful-dataset.json"));
    const tokenSecret = randomBytes(32).toString("base64url");
    app = await createPlatformApp({
      database: pool,
      tokenSecret,
      aiEngineUrl: process.env.LIVE_AI_ENGINE_URL || "http://ai-engine:8000",
      chainRpcUrl,
      contractPath: artifactPath,
      dependencyTimeoutMs: 60_000,
      optimizationTimeoutMs: 60_000,
      logger: false,
    });
    const users = await pool.query("SELECT user_id, username, role, chain_address FROM users");
    const user = (username) => users.rows.find((entry) => entry.username === username);
    const token = (username) => app.jwt.sign({ sub: user(username).user_id, role: user(username).role });
    const shipperHeaders = { authorization: `Bearer ${token("demo.shipper")}` };
    const carrierHeaders = { authorization: `Bearer ${token("demo.carrier")}` };
    const adminHeaders = { authorization: `Bearer ${token("demo.administrator")}` };
    const auditorHeaders = { authorization: `Bearer ${token("demo.auditor")}` };
    provider = new JsonRpcProvider(chainRpcUrl);
    const initialBlock = await provider.getBlock("latest");
    const slaDeadline = new Date((Number(initialBlock.timestamp) + 60 * 60 * 60) * 1000).toISOString();

    const order = await app.inject({ method: "POST", url: "/orders", headers: shipperHeaders, payload: {
      cargoType: "coal", quantityTonnes: 40, destination: "Port-A", priority: 1,
      deadline: slaDeadline,
    } });
    assert.equal(order.statusCode, 201, order.body);
    const optimized = await app.inject({ method: "POST", url: "/optimizations/run", headers: shipperHeaders, payload: {
      weights: { onTime: 1, cost: 1, utilization: 1 }, timeBudgetSeconds: 0.5,
    } });
    assert.equal(optimized.statusCode, 200, optimized.body);
    const plan = optimized.json();
    assert.ok(plan.assignments.length > 0, "Track 1 returns at least one usable assignment");

    const terms = {
      freightValuePaise: "2500000",
      penaltyBpsPerBlock: 200,
      penaltyBlockSeconds: 21600,
      freeHoldingHours: 6,
      demurrageRatePaisePerWagonHour: String(6000 / plan.assignments.reduce((count, item) => count + item.wagonIds.length, 0)),
      wagonCount: plan.assignments.reduce((count, item) => count + item.wagonIds.length, 0),
    };
    assert.equal(Number.isInteger(Number(terms.demurrageRatePaisePerWagonHour)), true);
    const acceptHeaders = { ...shipperHeaders, "idempotency-key": "phase18-accept-1" };
    const accepted = await app.inject({ method: "POST", url: `/plans/${plan.planId}/accept`, headers: acceptHeaders, payload: {
      carrierAddress: user("demo.carrier").chain_address,
      terms,
    } });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const acceptedAgain = await app.inject({ method: "POST", url: `/plans/${plan.planId}/accept`, headers: acceptHeaders, payload: {
      carrierAddress: user("demo.carrier").chain_address,
      terms,
    } });
    assert.equal(acceptedAgain.statusCode, 200);
    assert.deepEqual(acceptedAgain.json(), accepted.json());
    const contractId = accepted.json().contractId;
    assert.equal((await app.inject({ method: "GET", url: `/contracts/${contractId}`, headers: carrierHeaders })).statusCode, 200);
    const artifact = JSON.parse(require("node:fs").readFileSync(artifactPath, "utf8"));
    settlement = new Contract(artifact.address, artifact.abi, provider);

    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const port = new URL(address).port;
    const shipperSocket = await connectContractSocket(port, token("demo.shipper"));
    const carrierSocket = await connectContractSocket(port, token("demo.carrier"));
    const adminSocket = await connectContractSocket(port, token("demo.administrator"));
    const auditorSocket = await connectContractSocket(port, token("demo.auditor"));

    const wrongRole = await app.inject({ method: "POST", url: `/contracts/${contractId}/confirm-booking`, headers: { ...adminHeaders, "idempotency-key": "wrong-role" } });
    assert.equal(wrongRole.statusCode, 403);
    const pushedBookingPromise = waitForContractEvent(shipperSocket, "BookingConfirmed");
    const pushedCarrierBookingPromise = waitForContractEvent(carrierSocket, "BookingConfirmed");
    const adminBookingPromise = noContractEvent(adminSocket, "BookingConfirmed", 300);
    const auditorBookingPromise = noContractEvent(auditorSocket, "BookingConfirmed", 300);
    const carrierSigner = await provider.getSigner(user("demo.carrier").chain_address);
    const directBooking = await settlement.connect(carrierSigner).getFunction("confirmBooking")(BigInt(contractId));
    await directBooking.wait();
    const pushedBooking = await pushedBookingPromise;
    const pushedCarrierBooking = await pushedCarrierBookingPromise;
    assert.equal(pushedBooking.contractId, contractId);
    assert.equal(pushedCarrierBooking.contractId, contractId);
    assert.equal(await adminBookingPromise, true);
    assert.equal(await auditorBookingPromise, true);
    const directCachedDetail = await app.inject({ method: "GET", url: `/contracts/${contractId}`, headers: carrierHeaders });
    assert.equal(directCachedDetail.json().state, "Booked", "a direct on-chain event updates the API cache");
    const block = await provider.getBlock("latest");
    const dispatchPayload = { status: "Dispatched", timestamp: new Date(Number(block.timestamp) * 1000).toISOString() };
    const queuePool = new Pool({ connectionString: databaseUrl, max: 2, options: `-c search_path=${schema},public` });
    queueApp = await createPlatformApp({
      database: queuePool,
      tokenSecret,
      aiEngineUrl: process.env.LIVE_AI_ENGINE_URL || "http://ai-engine:8000",
      chainRpcUrl: "http://127.0.0.1:1",
      contractPath: artifactPath,
      logger: false,
    });
    const cachedDuringOutage = await queueApp.inject({ method: "GET", url: `/contracts/${contractId}`, headers: carrierHeaders });
    assert.equal(cachedDuringOutage.statusCode, 200, cachedDuringOutage.body);
    assert.equal(cachedDuringOutage.json().contractId, contractId);
    const cachedListDuringOutage = await queueApp.inject({ method: "GET", url: "/contracts", headers: carrierHeaders });
    assert.equal(cachedListDuringOutage.statusCode, 200, cachedListDuringOutage.body);
    assert.ok(cachedListDuringOutage.json().items.some((item) => item.contractId === contractId));
    const queuedDispatch = await queueApp.inject({ method: "POST", url: `/contracts/${contractId}/shipment-status`, headers: { ...carrierHeaders, "idempotency-key": "status-dispatch" }, payload: dispatchPayload });
    assert.equal(queuedDispatch.statusCode, 202, queuedDispatch.body);
    assert.equal(queuedDispatch.json().status, "queued");
    await queueApp.close();
    queueApp = undefined;
    const retriedOperation = await waitForOperation(pool, plan.planId, "shipment_status", "status-dispatch");
    assert.equal(retriedOperation.status, "succeeded", "queued status update is retried when the live chain is reachable");

    const deadlineResult = await pool.query("SELECT min(o.deadline) AS deadline FROM plan_orders po JOIN orders o ON o.order_id = po.order_id WHERE po.plan_id = $1 AND po.assigned = true", [plan.planId]);
    const slaDate = deadlineResult.rows[0].deadline;
    const slaSeconds = Math.floor(slaDate.valueOf() / 1000);
    const dispatchTime = BigInt(block.timestamp);
    const arrivalTime = BigInt(slaSeconds + 3 * 3600);
    const deliveryTime = BigInt(slaSeconds + 13 * 3600);
    const dispatch = await app.inject({ method: "POST", url: `/contracts/${contractId}/shipment-status`, headers: { ...carrierHeaders, "idempotency-key": "status-dispatch" }, payload: dispatchPayload });
    assert.equal(dispatch.statusCode, 200, dispatch.body);
    const arrived = await app.inject({ method: "POST", url: `/contracts/${contractId}/shipment-status`, headers: { ...carrierHeaders, "idempotency-key": "status-arrival" }, payload: {
      status: "ArrivedAtDestination", timestamp: new Date(Number(arrivalTime) * 1000).toISOString(),
    } });
    assert.equal(arrived.statusCode, 200, arrived.body);
    await provider.send("evm_increaseTime", [Number(deliveryTime - BigInt(block.timestamp) + 3600n)]);
    await provider.send("evm_mine", []);
    const delivery = await app.inject({ method: "POST", url: `/contracts/${contractId}/confirm-delivery`, headers: { ...carrierHeaders, "idempotency-key": "deliver-vector-f" }, payload: {
      timestamp: new Date(Number(deliveryTime) * 1000).toISOString(), podReference: "pod-phase18-vector-f",
    } });
    assert.equal(delivery.statusCode, 200, delivery.body);
    assert.deepEqual(delivery.json(), {
      contractId, state: "PenaltyCalculated", onTime: false, secondsLate: 13 * 3600,
      penaltyPaise: "150000", demurragePaise: "24000", netPaymentPaise: "2326000",
    });
    const deliveryAgain = await app.inject({ method: "POST", url: `/contracts/${contractId}/confirm-delivery`, headers: { ...carrierHeaders, "idempotency-key": "deliver-vector-f" }, payload: {
      timestamp: new Date(Number(deliveryTime) * 1000).toISOString(), podReference: "pod-phase18-vector-f",
    } });
    assert.deepEqual(deliveryAgain.json(), delivery.json());

    const dispute = await app.inject({ method: "POST", url: `/contracts/${contractId}/dispute`, headers: { ...shipperHeaders, "idempotency-key": "dispute-1" }, payload: { reasonCode: "VECTOR_TEST" } });
    assert.equal(dispute.statusCode, 200, dispute.body);
    const resolution = await app.inject({ method: "POST", url: `/contracts/${contractId}/resolve-dispute`, headers: { ...adminHeaders, "idempotency-key": "resolve-1" }, payload: { outcome: "UpholdDeductions" } });
    assert.equal(resolution.statusCode, 200, resolution.body);
    const released = await app.inject({ method: "POST", url: `/contracts/${contractId}/release-payment`, headers: { ...adminHeaders, "idempotency-key": "release-1" } });
    assert.equal(released.statusCode, 200, released.body);
    assert.equal(released.json().netPaymentPaise, "2326000");
    const closed = await app.inject({ method: "POST", url: `/contracts/${contractId}/close`, headers: { ...adminHeaders, "idempotency-key": "close-1" } });
    assert.equal(closed.statusCode, 200, closed.body);
    assert.equal(closed.json().state, "Closed");

    const onChain = await settlement.getFunction("getContractStatus")(BigInt(contractId));
    const contractRow = await pool.query("SELECT terms_hash, state, net_payment_paise::text FROM contracts WHERE contract_id = $1", [contractId]);
    assert.equal(onChain[0].terms.termsHash.toLowerCase(), contractRow.rows[0].terms_hash.toLowerCase());
    assert.equal(onChain[0].state, 6n);
    assert.equal(onChain[1].filter((entry) => Number(entry.action) === 1).length, 1, "queued booking is delivered exactly once");
    assert.equal(contractRow.rows[0].state, "Closed");
    assert.equal(contractRow.rows[0].net_payment_paise, "2326000");
    await pool.query("UPDATE contracts SET state = 'Created', penalty_paise = 0 WHERE contract_id = $1", [contractId]);
    await reconcileContract(pool, settlement, contractId);
    const repairedCache = await pool.query("SELECT state, penalty_paise::text, net_payment_paise::text FROM contracts WHERE contract_id = $1", [contractId]);
    assert.deepEqual(repairedCache.rows[0], { state: "Closed", penalty_paise: "150000", net_payment_paise: "2326000" }, "on-chain ledger repairs corrupted cached values");
    const eventCount = await waitForDatabaseEvents(pool, contractId, 10);
    assert.ok(eventCount >= 10, `expected lifecycle events in the PostgreSQL cache, found ${eventCount}`);
    const cachedDetail = await app.inject({ method: "GET", url: `/contracts/${contractId}`, headers: shipperHeaders });
    assert.equal(cachedDetail.statusCode, 200, cachedDetail.body);
    assert.equal(cachedDetail.json().history.some((event) => event.action === "DeliveryConfirmed"), true, JSON.stringify({ contractId, eventCount, history: cachedDetail.json().history }));
    const adminDetail = await app.inject({ method: "GET", url: `/contracts/${contractId}`, headers: adminHeaders });
    assert.equal(adminDetail.statusCode, 200);
    assert.equal(Object.hasOwn(adminDetail.json(), "terms"), false);
    assert.equal(Object.hasOwn(adminDetail.json(), "assignments"), false);
    assert.equal(Object.hasOwn(adminDetail.json(), "netPaymentPaise"), false);
    const auditorDetail = await app.inject({ method: "GET", url: `/contracts/${contractId}`, headers: auditorHeaders });
    assert.equal(auditorDetail.statusCode, 200);
    assert.equal(Object.hasOwn(auditorDetail.json(), "terms"), false);
    const adminList = await app.inject({ method: "GET", url: "/contracts", headers: adminHeaders });
    assert.equal(adminList.statusCode, 200);
    const adminSummary = adminList.json().items.find((item) => item.contractId === contractId);
    assert.ok(adminSummary);
    assert.equal(Object.hasOwn(adminSummary, "freightValuePaise"), false);
    const createdEvents = await settlement.queryFilter("AgreementCreated", 0, "latest");
    assert.equal(createdEvents.filter((event) => event.args.planId === plan.planId).length, 1, "idempotent accept created one on-chain agreement");
    const auditCount = await pool.query("SELECT count(*)::int AS count FROM audit_trail WHERE action LIKE 'contracts.%' OR action = 'plans.accept'");
    assert.ok(auditCount.rows[0].count >= 10);
    const summaryLatencies = [];
    for (let index = 0; index < 50; index += 1) {
      const started = performance.now();
      const summary = await app.inject({ method: "GET", url: "/contracts", headers: shipperHeaders });
      assert.equal(summary.statusCode, 200, summary.body);
      summaryLatencies.push(performance.now() - started);
    }
    summaryLatencies.sort((left, right) => left - right);
    assert.ok(summaryLatencies[Math.ceil(summaryLatencies.length * 0.95) - 1] < 500, `summary p95 was ${summaryLatencies[Math.ceil(summaryLatencies.length * 0.95) - 1].toFixed(1)}ms`);
  },
);

after(async () => {
  for (const socket of sockets) socket.close();
  await queueApp?.close();
  await app?.close();
  await provider?.destroy();
  if (databaseUrl && schema) {
    const cleanupPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await cleanupPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await cleanupPool.end();
  }
});

function connectContractSocket(port, token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/contracts`);
    sockets.push(socket);
    const timeout = setTimeout(() => reject(new Error("WebSocket authentication timed out")), 5000);
    socket.on("open", () => socket.send(JSON.stringify({ type: "authenticate", token })));
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "authenticated") {
        clearTimeout(timeout);
        resolve(socket);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForContractEvent(socket, action, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${action} push`)), timeoutMs);
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "contract.event" && message.action === action) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolve(message);
      }
    };
    socket.on("message", onMessage);
  });
}

function noContractEvent(socket, action, timeoutMs) {
  return new Promise((resolve, reject) => {
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "contract.event" && message.action === action) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        reject(new Error(`Nonparty received ${action}`));
      }
    };
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      resolve(true);
    }, timeoutMs);
    socket.on("message", onMessage);
  });
}

async function waitForDatabaseEvents(database, contractId, minimumCount, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await database.query("SELECT count(*)::int AS count FROM contract_events WHERE contract_id = $1", [contractId]);
    if (result.rows[0].count >= minimumCount) return result.rows[0].count;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return (await database.query("SELECT count(*)::int AS count FROM contract_events WHERE contract_id = $1", [contractId])).rows[0].count;
}

async function waitForOperation(database, planId, action, idempotencyKey, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await database.query(
      "SELECT status FROM contract_operations WHERE plan_id = $1 AND action = $2 AND idempotency_key = $3",
      [planId, action, idempotencyKey],
    );
    if (result.rows[0]?.status === "succeeded") return result.rows[0];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return (await database.query(
    "SELECT status FROM contract_operations WHERE plan_id = $1 AND action = $2 AND idempotency_key = $3",
    [planId, action, idempotencyKey],
  )).rows[0];
}
