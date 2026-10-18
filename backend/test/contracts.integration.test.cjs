const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { after, test } = require("node:test");
const { Pool } = require("pg");
const { JsonRpcProvider, Contract } = require("ethers");

const { createPlatformApp } = require("../dist/app.js");
const { runMigrations } = require("../dist/db/migrations.js");
const { seedDemoData } = require("../dist/db/seed.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const chainRpcUrl = process.env.LIVE_CHAIN_RPC_URL;
const artifactPath = process.env.LIVE_CONTRACT_PATH;
let app;
let pool;
let schema;
let provider;

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
    app = await createPlatformApp({
      database: pool,
      tokenSecret: randomBytes(32).toString("base64url"),
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

    const order = await app.inject({ method: "POST", url: "/orders", headers: shipperHeaders, payload: {
      cargoType: "coal", quantityTonnes: 40, destination: "Port-A", priority: 1,
      deadline: new Date(Date.now() + 60 * 60 * 60 * 1000).toISOString(),
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

    const wrongRole = await app.inject({ method: "POST", url: `/contracts/${contractId}/confirm-booking`, headers: { ...adminHeaders, "idempotency-key": "wrong-role" } });
    assert.equal(wrongRole.statusCode, 403);
    const booked = await app.inject({ method: "POST", url: `/contracts/${contractId}/confirm-booking`, headers: { ...carrierHeaders, "idempotency-key": "book-1" } });
    assert.equal(booked.statusCode, 200, booked.body);
    assert.equal(booked.json().state, "Booked");
    const bookedAgain = await app.inject({ method: "POST", url: `/contracts/${contractId}/confirm-booking`, headers: { ...carrierHeaders, "idempotency-key": "book-1" } });
    assert.deepEqual(bookedAgain.json(), booked.json());

    provider = new JsonRpcProvider(chainRpcUrl);
    const block = await provider.getBlock("latest");
    const deadlineResult = await pool.query("SELECT min(o.deadline) AS deadline FROM plan_orders po JOIN orders o ON o.order_id = po.order_id WHERE po.plan_id = $1 AND po.assigned = true", [plan.planId]);
    const slaDate = deadlineResult.rows[0].deadline;
    const slaSeconds = Math.floor(slaDate.valueOf() / 1000);
    const dispatchTime = BigInt(block.timestamp);
    const arrivalTime = BigInt(slaSeconds + 3 * 3600);
    const deliveryTime = BigInt(slaSeconds + 13 * 3600);
    const dispatch = await app.inject({ method: "POST", url: `/contracts/${contractId}/shipment-status`, headers: { ...carrierHeaders, "idempotency-key": "status-dispatch" }, payload: {
      status: "Dispatched", timestamp: new Date(Number(dispatchTime) * 1000).toISOString(),
    } });
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

    const artifact = JSON.parse(require("node:fs").readFileSync(artifactPath, "utf8"));
    const settlement = new Contract(artifact.address, artifact.abi, provider);
    const onChain = await settlement.getFunction("getContractStatus")(BigInt(contractId));
    const contractRow = await pool.query("SELECT terms_hash, state, net_payment_paise::text FROM contracts WHERE contract_id = $1", [contractId]);
    assert.equal(onChain[0].terms.termsHash.toLowerCase(), contractRow.rows[0].terms_hash.toLowerCase());
    assert.equal(onChain[0].state, 6n);
    assert.equal(contractRow.rows[0].state, "Closed");
    assert.equal(contractRow.rows[0].net_payment_paise, "2326000");
    const createdEvents = await settlement.queryFilter("AgreementCreated", 0, "latest");
    assert.equal(createdEvents.filter((event) => event.args.planId === plan.planId).length, 1, "idempotent accept created one on-chain agreement");
    const auditCount = await pool.query("SELECT count(*)::int AS count FROM audit_trail WHERE action LIKE 'contracts.%' OR action = 'plans.accept'");
    assert.ok(auditCount.rows[0].count >= 10);
  },
);

after(async () => {
  await app?.close();
  await provider?.destroy();
  if (databaseUrl && schema) {
    const cleanupPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await cleanupPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await cleanupPool.end();
  }
});
