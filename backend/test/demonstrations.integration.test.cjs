const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID, randomBytes } = require("node:crypto");
const { createServer } = require("node:http");
const { resolve } = require("node:path");
const { Pool } = require("pg");
const { createPlatformApp } = require("../dist/app.js");
const { runMigrations } = require("../dist/db/migrations.js");
const { seedDemoData } = require("../dist/db/seed.js");

test("order register ownership/pagination and authenticated fixed AI demonstrations", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const schema = `demo_test_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let app, pool, stub;
  try {
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
    process.env.DEMO_USER_PASSWORD = randomBytes(24).toString("base64url");
    await runMigrations(pool);
    await seedDemoData(pool, resolve(__dirname, "../../samples/plentiful-dataset.json"));
    let unavailable = false;
    const calls = [];
    stub = createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      calls.push({ path: req.url, body: body ? JSON.parse(body) : null });
      res.writeHead(unavailable ? 503 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url === "/demo/evidence.json" ? { evaluation: { accuracy: 0.9735 } } : { synthetic: true, kind: "ml" }));
    });
    await new Promise(resolve => stub.listen(0, "127.0.0.1", resolve));
    app = await createPlatformApp({ database: pool, tokenSecret: randomBytes(32).toString("base64url"), aiEngineUrl: `http://127.0.0.1:${stub.address().port}`, logger: false });
    const users = (await pool.query("SELECT user_id, role FROM users")).rows;
    const headers = role => ({ authorization: `Bearer ${app.jwt.sign({ sub: users.find(u => u.role === role).user_id, role })}` });
    const shipper = headers("Shipper"), administrator = headers("Administrator");
    const input = { cargoType: "grain", quantityTonnes: 20, destination: "Port-A", priority: 1, deadline: new Date(Date.now() + 7 * 86400000).toISOString() };
    const first = await app.inject({ method: "POST", url: "/orders", headers: shipper, payload: input });
    assert.equal(first.statusCode, 201);
    await app.inject({ method: "POST", url: "/orders", headers: administrator, payload: input });
    const own = await app.inject({ method: "GET", url: "/orders", headers: shipper });
    assert.equal(own.statusCode, 200, own.body);
    assert.equal(own.json().total, 1);
    assert.equal(own.json().items[0].orderId, first.json().orderId);
    assert.equal(own.json().items[0].quantityTonnes, 20);
    const all = await app.inject({ method: "GET", url: "/orders?limit=1&offset=0", headers: administrator });
    assert.equal(all.json().total, 2);
    assert.equal(all.json().nextOffset, 1);
    const second = await app.inject({ method: "GET", url: "/orders?limit=1&offset=1", headers: administrator });
    assert.notEqual(second.json().items[0].orderId, all.json().items[0].orderId);
    assert.equal(second.json().nextOffset, null);
    assert.equal((await app.inject({ method: "GET", url: "/orders?status=Planned", headers: shipper })).json().total, 0);
    assert.equal((await app.inject({ method: "GET", url: "/orders?status=Invalid", headers: shipper })).statusCode, 400);
    assert.equal((await app.inject({ method: "GET", url: "/orders", headers: headers("Carrier") })).statusCode, 403);
    assert.equal((await app.inject({ method: "GET", url: "/ai/demonstrations/evaluation" })).statusCode, 401);
    for (const role of ["Shipper", "Carrier", "Administrator", "Auditor"]) {
      const response = await app.inject({ method: "POST", url: "/ai/demonstrations/run", headers: headers(role), payload: { kind: "ml", cargo: "grain", slackRatio: 0.25 } });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().synthetic, true);
      assert.deepEqual(calls.at(-1), { path: "/v1/demonstrations", body: { kind: "ml", cargo: "grain", slackRatio: 0.25 } });
    }
    assert.equal((await app.inject({ method: "POST", url: "/ai/demonstrations/run", headers: shipper, payload: { kind: "ml", slackRatio: 100 } })).statusCode, 400);
    const evaluation = await app.inject({ method: "GET", url: "/ai/demonstrations/evaluation", headers: shipper });
    assert.equal(evaluation.json().evaluation.accuracy, 0.9735);
    unavailable = true;
    assert.equal((await app.inject({ method: "GET", url: "/ai/demonstrations/evaluation", headers: shipper })).statusCode, 503);
    assert.equal((await app.inject({ method: "POST", url: "/ai/demonstrations/run", headers: shipper, payload: { kind: "cp-sat" } })).statusCode, 503);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders")).rows[0].n, 2);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM allocation_plans")).rows[0].n, 0);
  } finally {
    if (app) await app.close(); else if (pool) await pool.end();
    if (stub) await new Promise(resolve => stub.close(resolve));
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await adminPool.end();
  }
});
