const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const { test } = require("node:test");
const { Pool } = require("pg");
const { Wallet, NonceManager, JsonRpcProvider, ContractFactory, parseEther } = require("ethers");
const { createPlatformApp } = require("../dist/app.js");
const { runMigrations } = require("../dist/db/migrations.js");
const { seedDemoData } = require("../dist/db/seed.js");

test("wallet ownership, verified deployment, atomic freight mint, and wallet-signed settlement lifecycle", {
  skip: !(process.env.TEST_DATABASE_URL && process.env.LIVE_CHAIN_RPC_URL && process.env.DAPP_BUILD_PATH) && "Set TEST_DATABASE_URL, LIVE_CHAIN_RPC_URL, DAPP_BUILD_PATH for the isolated local wallet integration test.",
  timeout: 120_000,
}, async () => {
  const schema = `dapp_test_${randomUUID().replaceAll("-", "")}`;
  const setup = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let app; let pool;
  const provider = new JsonRpcProvider(process.env.LIVE_CHAIN_RPC_URL);
  const original = { DAPP_CHAIN_ID: process.env.DAPP_CHAIN_ID, DAPP_RPC_URL: process.env.DAPP_RPC_URL, DEMO_USER_PASSWORD: process.env.DEMO_USER_PASSWORD };
  try {
    process.env.DAPP_CHAIN_ID = "31337"; process.env.DAPP_RPC_URL = process.env.LIVE_CHAIN_RPC_URL;
    process.env.DEMO_USER_PASSWORD = randomBytes(24).toString("base64url");
    await setup.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public`, max: 4 });
    await runMigrations(pool); await seedDemoData(pool, process.env.MASTER_DATA_SEED_PATH);
    app = await createPlatformApp({ database: pool, tokenSecret: randomBytes(32).toString("base64url"), logger: false,
      aiEngineUrl: process.env.LIVE_AI_ENGINE_URL || "http://ai-engine:8000", chainRpcUrl: process.env.LIVE_CHAIN_RPC_URL,
      contractPath: process.env.LIVE_CONTRACT_PATH || "/shared/contract.json", optimizationTimeoutMs: 60000 });
    const users = (await pool.query("SELECT * FROM users")).rows;
    const headers = role => ({ authorization: `Bearer ${app.jwt.sign({ sub: users.find(u => u.role === role).user_id, role })}` });
    const request = async (role, method, url, payload) => app.inject({ method, url, headers: headers(role), ...(payload ? { payload } : {}) });
    assert.equal((await app.inject({ method: "GET", url: "/dapp/config" })).statusCode, 401);
    assert.equal((await request("Auditor", "GET", "/dapp/build")).statusCode, 403);
    const operator = Wallet.createRandom().connect(provider); const carrier = Wallet.createRandom().connect(provider);
    const operatorSender = new NonceManager(operator); const carrierSender = new NonceManager(carrier);
    const funder = await provider.getSigner(0);
    for (const wallet of [operator, carrier]) await (await funder.sendTransaction({ to: wallet.address, value: parseEther("1") })).wait();
    for (const [role, wallet] of [["Administrator", operator], ["Carrier", carrier]]) {
      const challenge = await request(role, "POST", "/dapp/wallet/challenge", { address: wallet.address });
      assert.equal(challenge.statusCode, 200, challenge.body);
      const { challengeId, message } = challenge.json();
      const wrong = await request(role, "POST", "/dapp/wallet/verify", { challengeId, signature: await Wallet.createRandom().signMessage(message) });
      assert.equal(wrong.statusCode, 403);
      const payload = { challengeId, signature: await wallet.signMessage(message) };
      assert.equal((await request(role, "POST", "/dapp/wallet/verify", payload)).statusCode, 200);
      assert.equal((await request(role, "POST", "/dapp/wallet/verify", payload)).statusCode, 400, "a challenge cannot be replayed");
    }
    const build = JSON.parse(await readFile(process.env.DAPP_BUILD_PATH, "utf8"));
    const settlement = await new ContractFactory(build.abi, build.bytecode, operatorSender).deploy();
    await settlement.waitForDeployment();
    const deployed = await request("Administrator", "POST", "/dapp/deployments", { transactionHash: settlement.deploymentTransaction().hash });
    assert.equal(deployed.statusCode, 200, deployed.body);
    const latest = await provider.getBlock("latest");
    const order = await request("Administrator", "POST", "/orders", { cargoType: "coal", quantityTonnes: 40, destination: "Port-A", priority: 1, deadline: new Date((latest.timestamp + 7 * 86400) * 1000).toISOString() });
    assert.equal(order.statusCode, 201, order.body);
    const optimization = await request("Administrator", "POST", "/optimizations/run", { weights: { onTime: 1, cost: 1, utilization: 1 }, timeBudgetSeconds: 0.5 });
    assert.equal(optimization.statusCode, 200, optimization.body); const plan = optimization.json();
    const input = { planId: plan.planId, carrierAddress: carrier.address, terms: { freightValuePaise: "2500000", penaltyBpsPerBlock: 100, penaltyBlockSeconds: 3600, freeHoldingHours: 4, demurrageRatePaisePerWagonHour: "5000" } };
    assert.equal((await request("Shipper", "POST", "/dapp/freights/prepare", input)).statusCode, 409, "unlinked shipper is rejected");
    const prepared = await request("Administrator", "POST", "/dapp/freights/prepare", input);
    assert.equal(prepared.statusCode, 200, prepared.body); const { freight, transaction } = prepared.json();
    const repeated = await request("Administrator", "POST", "/dapp/freights/prepare", input);
    assert.equal(repeated.json().freight.freight_id, freight.freight_id);
    const changed = await request("Administrator", "POST", "/dapp/freights/prepare", { ...input, terms: { ...input.terms, freightValuePaise: "1" } });
    assert.equal(changed.statusCode, 409);
    const tx = await operatorSender.sendTransaction({ to: transaction.to, data: transaction.data, value: 0n }); await tx.wait();
    const mismatched = await request("Administrator", "POST", `/dapp/freights/${freight.freight_id}/submit`, { transactionHash: settlement.deploymentTransaction().hash });
    assert.equal(mismatched.statusCode, 400, "a real but unrelated deployment transaction cannot prove freight initiation");
    const submitted = await request("Administrator", "POST", `/dapp/freights/${freight.freight_id}/submit`, { transactionHash: tx.hash });
    assert.equal(submitted.statusCode, 200, submitted.body);
    const refreshed = await request("Administrator", "POST", `/dapp/freights/${freight.freight_id}/refresh`);
    assert.equal(refreshed.statusCode, 200, refreshed.body); const confirmed = refreshed.json();
    assert.equal(confirmed.state, "Created"); assert.equal(confirmed.receiptOwner, operator.address); assert.ok(confirmed.block_timestamp); assert.ok(BigInt(confirmed.fee_wei) > 0n);
    assert.equal(await settlement.totalFreightReceipts(), 1n);
    assert.equal((await request("Shipper", "GET", "/dapp/freights")).json().items.length, 0, "unrelated shipper cannot list this freight");
    const forbidden = await request("Administrator", "POST", `/dapp/freights/${freight.freight_id}/action`, { action: "confirmBooking" });
    assert.equal(forbidden.statusCode, 403);
    async function action(role, wallet, body) {
      const prepared = await request(role, "POST", `/dapp/freights/${freight.freight_id}/action`, body);
      assert.equal(prepared.statusCode, 200, prepared.body); const data = prepared.json();
      const sender = wallet.address === operator.address ? operatorSender : carrierSender;
      const tx = await sender.sendTransaction({ to: data.to, data: data.data, value: 0n }); await tx.wait();
      const receipt = await request(role, "POST", `/dapp/freights/${freight.freight_id}/action-receipt`, { transactionHash: tx.hash });
      assert.equal(receipt.statusCode, 200, receipt.body); assert.equal(receipt.json().status, "confirmed");
      const refreshed = await request(role, "POST", `/dapp/freights/${freight.freight_id}/refresh`);
      assert.equal(refreshed.statusCode, 200, refreshed.body); return refreshed.json();
    }
    assert.equal((await action("Carrier", carrier, { action: "confirmBooking" })).state, "Booked");
    // Bypass ethers' short-lived "latest" cache after the booking transaction.
    const now = Number((await provider.send("eth_getBlockByNumber", ["latest", false])).timestamp);
    assert.equal((await action("Carrier", carrier, { action: "updateShipmentStatus", status: 0, timestamp: now })).state, "InTransit");
    const delivered = await action("Carrier", carrier, { action: "confirmDelivery", timestamp: now, podReference: "test-pod" });
    assert.equal(delivered.state, "PenaltyCalculated"); assert.equal(delivered.accounting.penaltyPaise, "0");
    assert.equal((await action("Administrator", operator, { action: "releasePayment" })).state, "PaymentReleased");
    assert.equal((await action("Administrator", operator, { action: "closeContract" })).state, "Closed");
    const history = (await request("Auditor", "GET", "/dapp/freights")).json().items[0].actions;
    assert.equal(history.length, 5); assert.ok(history.every(entry => entry.status === "confirmed"));
    assert.equal(await provider.getBalance(await settlement.getAddress()), 0n);
  } finally {
    if (app) await app.close(); else if (pool) await pool.end();
    await setup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await setup.end(); provider.destroy();
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
