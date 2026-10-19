const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { after, test } = require("node:test");
const Fastify = require("fastify");
const { Pool } = require("pg");
const WebSocket = require("ws");
const { runMigrations } = require("../dist/db/migrations.js");
const { registerAuthentication } = require("../dist/auth/plugin.js");
const { registerContractPush } = require("../dist/contracts/push.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
let app, pool, schema;
const sockets = [];
test("live party events reject disabled or changed roles and expire on the server", {
  skip: !databaseUrl && "Set TEST_DATABASE_URL for PostgreSQL integration.", timeout: 20000,
}, async () => {
  schema = `push_auth_${randomUUID().replaceAll("-", "")}`;
  const setup = new Pool({ connectionString: databaseUrl });
  await setup.query(`CREATE SCHEMA ${schema}`); await setup.end();
  pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` });
  await runMigrations(pool);
  const shipper = randomUUID(), carrier = randomUUID();
  await pool.query("INSERT INTO users (user_id, username, role) VALUES ($1, 'push.shipper', 'Shipper'), ($2, 'push.carrier', 'Carrier')", [shipper, carrier]);
  app = Fastify({ logger: false });
  await registerAuthentication(app, pool, randomBytes(32).toString("base64url"));
  const push = registerContractPush(app, pool);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const connect = (userId, role, expiresIn = 900) => new Promise((resolve, reject) => {
    const socket = new WebSocket(address.replace("http:", "ws:") + "/ws/contracts"); sockets.push(socket);
    socket.once("error", reject);
    socket.once("open", () => socket.send(JSON.stringify({ type: "authenticate", token: app.jwt.sign({ sub: userId, role }, { expiresIn }) })));
    socket.once("message", (message) => { assert.equal(JSON.parse(message).type, "authenticated"); resolve(socket); });
  });
  const event = { contractId: "1", action: "BookingConfirmed", occurredAt: new Date().toISOString(), transactionHash: null, state: "Booked" };
  const disabled = await connect(shipper, "Shipper");
  const active = await connect(carrier, "Carrier");
  let privateEvents = 0;
  disabled.on("message", () => privateEvents++);
  const disabledClosed = new Promise((resolve) => disabled.once("close", (code) => resolve(code)));
  const activeReceived = new Promise((resolve) => active.once("message", (data) => resolve(JSON.parse(data).type)));
  await pool.query("UPDATE users SET active = false WHERE user_id = $1", [shipper]);
  await push.broadcast(event, shipper, carrier);
  assert.equal(await disabledClosed, 4401); assert.equal(privateEvents, 0);
  assert.equal(await activeReceived, "contract.event");
  const changedClosed = new Promise((resolve) => active.once("close", (code) => resolve(code)));
  await pool.query("UPDATE users SET role = 'Auditor' WHERE user_id = $1", [carrier]);
  await push.broadcast(event, shipper, carrier);
  assert.equal(await changedClosed, 4401);
  await pool.query("UPDATE users SET active = true WHERE user_id = $1", [shipper]);
  const expires = await connect(shipper, "Shipper", 2);
  assert.equal(await new Promise((resolve) => expires.once("close", (code) => resolve(code))), 4401);
});
after(async () => {
  for (const socket of sockets) socket.terminate();
  if (app) await app.close(); if (pool) await pool.end();
  if (schema) { const cleanup = new Pool({ connectionString: databaseUrl }); await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await cleanup.end(); }
});
