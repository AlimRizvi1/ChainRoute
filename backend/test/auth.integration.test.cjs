const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const { randomUUID, randomBytes } = require("node:crypto");
const { resolve } = require("node:path");
const { after, test } = require("node:test");
const { Pool } = require("pg");

const { createPlatformApp } = require("../dist/app.js");
const { runMigrations } = require("../dist/db/migrations.js");
const { seedDemoData } = require("../dist/db/seed.js");

const databaseUrl = process.env.TEST_DATABASE_URL;
const demoPassword = process.env.DEMO_USER_PASSWORD ?? randomBytes(24).toString("base64url");
let app;
let pool;
let schema;
let logs = "";

test(
  "authentication, role enforcement, inactive-user rejection, redaction, and one audit row per write",
  { skip: !databaseUrl && "Set TEST_DATABASE_URL to a dedicated local ChainRoute PostgreSQL database." },
  async () => {
    process.env.DEMO_USER_PASSWORD = demoPassword;
    schema = `phase16_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
    const setupPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await setupPool.query(`CREATE SCHEMA ${schema}`);
    await setupPool.end();
    pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(pool);
    await seedDemoData(pool, resolve(__dirname, "../../samples/plentiful-dataset.json"));

    const logStream = new PassThrough();
    logStream.on("data", (chunk) => { logs += chunk.toString("utf8"); });
    app = await createPlatformApp({
      database: pool,
      tokenSecret: randomBytes(32).toString("base64url"),
      aiEngineUrl: "http://127.0.0.1:1",
      chainRpcUrl: "http://127.0.0.1:1",
      dependencyTimeoutMs: 100,
      loggerStream: logStream,
    });
    app.get(
      "/test/protected",
      { config: { permission: "artifact.read" } },
      async () => ({ ok: true }),
    );
    app.get("/test/unclassified", async () => ({ ok: true }));
    app.post(
      "/test/orders",
      {
        config: {
          permission: "orders.create",
          auditAction: "orders.create",
          auditResourceType: "order",
        },
      },
      async () => ({ ok: true }),
    );

    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/test/protected" })).statusCode, 401);
    assert.equal((await app.inject({
      method: "GET",
      url: "/test/protected",
      headers: { authorization: "Bearer malformed" },
    })).statusCode, 401);

    const badPasswordMarker = "do-not-log-this-password";
    const failedLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "demo.shipper", password: badPasswordMarker },
    });
    assert.equal(failedLogin.statusCode, 401);
    assert.equal(JSON.stringify(failedLogin.json()).includes(badPasswordMarker), false);

    const tokens = new Map();
    for (const [username, role] of [
      ["demo.shipper", "Shipper"],
      ["demo.carrier", "Carrier"],
      ["demo.administrator", "Administrator"],
      ["demo.auditor", "Auditor"],
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { username, password: demoPassword },
      });
      assert.equal(response.statusCode, 200, `${username} can log in`);
      const body = response.json();
      assert.equal(body.user.role, role);
      assert.equal(body.expiresIn, 900);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal(JSON.stringify(body).includes(demoPassword), false);
      tokens.set(role, body.token);
    }

    const limitedLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "demo.shipper", password: demoPassword },
    });
    assert.equal(limitedLogin.statusCode, 429);

    const shipper = await pool.query("SELECT user_id FROM users WHERE username = 'demo.shipper'");
    const wrongRoleToken = app.jwt.sign({ sub: shipper.rows[0].user_id, role: "Administrator" });
    assert.equal((await app.inject({
      method: "GET",
      url: "/test/protected",
      headers: { authorization: `Bearer ${wrongRoleToken}` },
    })).statusCode, 401);
    const expiredToken = app.jwt.sign(
      { sub: shipper.rows[0].user_id, role: "Shipper" },
      { expiresIn: -1 },
    );
    assert.equal((await app.inject({
      method: "GET",
      url: "/test/protected",
      headers: { authorization: `Bearer ${expiredToken}` },
    })).statusCode, 401);

    const shipperToken = tokens.get("Shipper");
    assert.equal((await app.inject({
      method: "GET",
      url: "/test/unclassified",
      headers: { authorization: `Bearer ${tokens.get("Administrator")}` },
    })).statusCode, 403);
    await pool.query("UPDATE users SET active = false WHERE user_id = $1", [shipper.rows[0].user_id]);
    assert.equal((await app.inject({
      method: "GET",
      url: "/test/protected",
      headers: { authorization: `Bearer ${shipperToken}` },
    })).statusCode, 401);
    await pool.query("UPDATE users SET active = true WHERE user_id = $1", [shipper.rows[0].user_id]);

    const anonymousDenied = await app.inject({
      method: "POST",
      url: "/test/orders",
      payload: {},
    });
    assert.equal(anonymousDenied.statusCode, 401);
    const carrierDenied = await app.inject({
      method: "POST",
      url: "/test/orders",
      headers: { authorization: `Bearer ${tokens.get("Carrier")}` },
      payload: {},
    });
    assert.equal(carrierDenied.statusCode, 403);
    const shipperAllowed = await app.inject({
      method: "POST",
      url: "/test/orders",
      headers: { authorization: `Bearer ${shipperToken}` },
      payload: {},
    });
    assert.equal(shipperAllowed.statusCode, 200);
    const audit = await pool.query(
      "SELECT user_id, action, request_id, outcome FROM audit_trail WHERE action = 'orders.create' ORDER BY audit_id",
    );
    assert.equal(audit.rowCount, 3);
    assert.equal(new Set(audit.rows.map((row) => row.request_id)).size, 3);
    const carrier = await pool.query("SELECT user_id FROM users WHERE username = 'demo.carrier'");
    assert.equal(audit.rows[0].user_id, null);
    assert.equal(audit.rows[0].outcome, "failure");
    assert.equal(audit.rows[1].user_id, carrier.rows[0].user_id);
    assert.equal(audit.rows[1].outcome, "failure");
    assert.equal(audit.rows[2].user_id, shipper.rows[0].user_id);
    assert.equal(audit.rows[2].outcome, "success");

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(logs.includes(badPasswordMarker), false);
    assert.equal(logs.includes(demoPassword), false);

    await app.close();
    app = null;
    pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      options: `-c search_path=${schema},public`,
    });
    app = await createPlatformApp({
      database: pool,
      tokenSecret: randomBytes(32).toString("base64url"),
      logger: false,
    });
    const missingUser = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "unknown-user", password: badPasswordMarker },
    });
    assert.equal(missingUser.statusCode, 401);
    assert.equal(JSON.stringify(missingUser.json()).includes(badPasswordMarker), false);
  },
);

after(async () => {
  if (app) await app.close();
  else if (pool) await pool.end();
  if (databaseUrl && schema) {
    const cleanupPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await cleanupPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await cleanupPool.end();
  }
});
