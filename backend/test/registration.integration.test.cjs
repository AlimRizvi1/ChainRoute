const assert = require("node:assert/strict");
const { randomUUID, randomBytes, createHash } = require("node:crypto");
const { resolve } = require("node:path");
const { after, test } = require("node:test");
const { Pool } = require("pg");
const { createPlatformApp } = require("../dist/app.js");
const { runMigrations } = require("../dist/db/migrations.js");
const { seedDemoData } = require("../dist/db/seed.js");
const { verifyPassword } = require("../dist/auth/password.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
let app, pool, schema;
let ip = 1;
const password = "a-long-registration-test-passphrase";

test("registration, controlled role invitations, concurrent redemption, and account revocation", {
  skip: !databaseUrl && "Set TEST_DATABASE_URL to a dedicated local ChainRoute PostgreSQL database.",
}, async () => {
  schema = `registration_test_${randomUUID().replaceAll("-", "")}`;
  const setup = new Pool({ connectionString: databaseUrl });
  await setup.query(`CREATE SCHEMA ${schema}`); await setup.end();
  pool = new Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${schema},public` });
  await runMigrations(pool);
  process.env.DEMO_USER_PASSWORD = randomBytes(24).toString("base64url");
  await seedDemoData(pool, resolve(__dirname, "../../samples/plentiful-dataset.json"));
  app = await createPlatformApp({ database: pool, tokenSecret: randomBytes(32).toString("base64url"), logger: false });
  const request = (method, url, payload, token, remoteAddress = `192.0.2.${ip++}`) => app.inject({ method, url, payload, remoteAddress, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const signup = (username, invitationToken) => request("POST", "/auth/signup", { username, password, ...(invitationToken ? { invitationToken } : {}) });

  const registered = await signup("New.Shipper");
  assert.equal(registered.statusCode, 201, registered.body);
  assert.equal(registered.headers["cache-control"], "no-store");
  const account = registered.json();
  assert.equal(account.user.role, "Shipper"); assert.equal(account.user.username, "new.shipper");
  assert.ok(account.token); assert.equal(account.expiresIn, 900);
  assert.equal(registered.body.includes(password), false);
  const saved = (await pool.query("SELECT password_hash, chain_address FROM users WHERE user_id = $1", [account.user.id])).rows[0];
  assert.notEqual(saved.password_hash, password); assert.equal(await verifyPassword(password, saved.password_hash), true);
  assert.equal(saved.chain_address, null);
  assert.equal((await signup("NEW.SHIPPER")).statusCode, 409);
  assert.equal((await request("POST", "/auth/signup", { username: "weak-password", password: "short" })).statusCode, 400);
  assert.equal((await request("POST", "/auth/signup", { username: "unicode-password", password: "é".repeat(200) })).statusCode, 400);
  const elevated = await request("POST", "/auth/signup", { username: "no-elevation", password, role: "Administrator", chainAddress: `0x${"1".repeat(40)}` });
  assert.ok([201, 400].includes(elevated.statusCode));
  if (elevated.statusCode === 201) assert.equal(elevated.json().user.role, "Shipper");
  const login = await request("POST", "/auth/login", { username: " NEW.SHIPPER ", password });
  assert.equal(login.statusCode, 200);
  assert.equal((await request("GET", "/admin/users", undefined, account.token)).statusCode, 403);
  assert.equal((await request("POST", "/admin/invitations", { role: "Administrator" }, account.token)).statusCode, 403);
  assert.equal((await request("POST", "/admin/invitations", { role: "Carrier" })).statusCode, 401);
  const admin = (await pool.query("SELECT user_id FROM users WHERE role = 'Administrator'")).rows[0];
  const adminToken = app.jwt.sign({ sub: admin.user_id, role: "Administrator" });
  const forged = app.jwt.sign({ sub: account.user.id, role: "Administrator" });
  assert.equal((await request("GET", "/admin/users", undefined, forged)).statusCode, 401);

  for (const role of ["Carrier", "Auditor", "Administrator"]) {
    const created = await request("POST", "/admin/invitations", { role }, adminToken);
    assert.equal(created.statusCode, 201, created.body);
    const invitation = created.json();
    const stored = (await pool.query("SELECT token_hash FROM account_invitations WHERE invitation_id = $1", [invitation.id])).rows[0];
    assert.notEqual(stored.token_hash, invitation.invitationToken);
    assert.equal(stored.token_hash, createHash("sha256").update(invitation.invitationToken).digest("hex"));
    const preview = await request("POST", "/auth/invitations/preview", { invitationToken: invitation.invitationToken });
    assert.equal(preview.json().role, role);
    const joined = await signup(`invited-${role.toLowerCase()}`, invitation.invitationToken);
    assert.equal(joined.statusCode, 201, joined.body); assert.equal(joined.json().user.role, role);
    assert.equal((await signup(`reuse-${role.toLowerCase()}`, invitation.invitationToken)).statusCode, 400);
    if (role !== "Administrator") assert.equal((await request("GET", "/admin/users", undefined, joined.json().token)).statusCode, 403);
  }
  const createInvite = async () => (await request("POST", "/admin/invitations", { role: "Carrier" }, adminToken)).json();
  const revoked = await createInvite();
  assert.equal((await request("DELETE", `/admin/invitations/${revoked.id}`, undefined, adminToken)).statusCode, 204);
  assert.equal((await signup("revoked-carrier", revoked.invitationToken)).statusCode, 400);
  const expired = await createInvite();
  await pool.query("UPDATE account_invitations SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE invitation_id = $1", [expired.id]);
  assert.equal((await signup("expired-carrier", expired.invitationToken)).statusCode, 400);
  const concurrent = await createInvite();
  const results = await Promise.all([signup("racer-one", concurrent.invitationToken), signup("racer-two", concurrent.invitationToken)]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [201, 400]);
  const reusable = await createInvite();
  assert.equal((await signup("new.shipper", reusable.invitationToken)).statusCode, 409);
  assert.equal((await signup("valid-carrier", reusable.invitationToken)).statusCode, 201);

  assert.equal((await request("PATCH", `/admin/users/${account.user.id}`, { active: false }, adminToken)).statusCode, 200);
  assert.equal((await request("GET", "/contracts", undefined, account.token)).statusCode, 401);
  assert.equal((await request("POST", "/auth/login", { username: "new.shipper", password })).statusCode, 401);
  assert.equal((await request("PATCH", `/admin/users/${admin.user_id}`, { active: false }, adminToken)).statusCode, 409);
  const directory = await request("GET", "/admin/users", undefined, adminToken);
  assert.equal(directory.statusCode, 200); assert.equal(directory.body.includes("password_hash"), false);
  assert.equal(directory.body.includes(password), false);
  for (let attempt = 0; attempt < 6; attempt++) {
    const limited = await request("POST", "/auth/signup", { username: "limited", password: "short" }, undefined, "198.51.100.1");
    assert.equal(limited.statusCode, attempt === 5 ? 429 : 400);
  }
});

after(async () => {
  if (app) await app.close(); else if (pool) await pool.end();
  if (schema) {
    const cleanup = new Pool({ connectionString: databaseUrl });
    await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await cleanup.end();
  }
});
