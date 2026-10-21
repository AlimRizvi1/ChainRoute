const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { resolve } = require("node:path");
const { after, test } = require("node:test");
const { Pool } = require("pg");

const { runMigrations } = require("../dist/db/migrations.js");
const { seedDemoData } = require("../dist/db/seed.js");
const { verifyPassword } = require("../dist/auth/password.js");

const databaseUrl = process.env.TEST_DATABASE_URL;
const demoPassword = process.env.DEMO_USER_PASSWORD ?? randomBytes(24).toString("base64url");
let pool;
let schema;

test(
  "PostgreSQL migration, seed, constraints, relationships, and repeatable reruns",
  { skip: !databaseUrl && "Set TEST_DATABASE_URL to a dedicated local ChainRoute PostgreSQL database." },
  async () => {
    process.env.DEMO_USER_PASSWORD = demoPassword;
    schema = `phase15_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
    const setupPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await setupPool.query(`CREATE SCHEMA ${schema}`);
    await setupPool.end();

    // Apply the schema on every connection. A pool.query error can cause pg to
    // discard a connection, so a one-time session SET is not sufficient.
    pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      options: `-c search_path=${schema},public`,
    });

    const firstApply = await runMigrations(pool);
    assert.deepEqual(firstApply, [
      "001_track3_platform_schema.sql",
      "002_authentication_audit.sql",
      "003_contract_operations.sql",
      "004_event_sync_and_action_queue.sql",
      "005_saved_what_if_scenarios.sql",
      "006_account_registration.sql",
      "007_replay_event_history_hashes.sql",
    ]);
    assert.deepEqual(await runMigrations(pool), []);

    const fixturePath = resolve(
      __dirname,
      "../../samples/plentiful-dataset.json",
    );
    const firstSeed = await seedDemoData(pool, fixturePath);
    assert.equal(firstSeed.users, 4);
    assert.ok(firstSeed.wagons > 0);
    assert.ok(firstSeed.routes > 0);
    assert.deepEqual(await seedDemoData(pool, fixturePath), {
      users: 0,
      wagons: 0,
      routes: 0,
    });

    const seededUser = await pool.query(
      "SELECT user_id, password_hash FROM users WHERE username = 'demo.shipper'",
    );
    assert.equal(seededUser.rowCount, 1);
    assert.notEqual(seededUser.rows[0].password_hash, "chainroute-demo-local");
    assert.equal(
      await verifyPassword(demoPassword, seededUser.rows[0].password_hash),
      true,
    );
    const originalPasswordHash = seededUser.rows[0].password_hash;
    const credentialSalts = await pool.query(
      "SELECT DISTINCT split_part(password_hash, '$', 5) AS salt FROM users",
    );
    assert.equal(credentialSalts.rowCount, 4);

    await assert.rejects(
      pool.query(
        `INSERT INTO wagons (wagon_id, capacity_tonnes, wagon_type, location)
         VALUES ('invalid-wagon', -1, 'covered', 'Yard-0')`,
      ),
      (error) => error.code === "23514",
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO allocation_plans (plan_id, run_id, created_by, plan_payload, score, scenario_group_id)
         VALUES ('dangling-plan', 'missing-run', $1, '{}'::jsonb, 0, 'dangling-plan')`,
        [seededUser.rows[0].user_id],
      ),
      (error) => error.code === "23503",
    );

    const changedMaster = await pool.query(
      "SELECT wagon_id FROM wagons ORDER BY wagon_id LIMIT 1",
    );
    await pool.query(
      "UPDATE wagons SET capacity_tonnes = 12345 WHERE wagon_id = $1",
      [changedMaster.rows[0].wagon_id],
    );
    await seedDemoData(pool, fixturePath);
    const preservedCredential = await pool.query(
      "SELECT password_hash FROM users WHERE username = 'demo.shipper'",
    );
    assert.equal(preservedCredential.rows[0].password_hash, originalPasswordHash);
    const preservedMaster = await pool.query(
      "SELECT capacity_tonnes FROM wagons WHERE wagon_id = $1",
      [changedMaster.rows[0].wagon_id],
    );
    assert.equal(preservedMaster.rows[0].capacity_tonnes, "12345.000");

    await pool.query(
      `INSERT INTO orders (
         order_id, created_by, cargo_type, quantity_tonnes, destination, priority, deadline
       ) VALUES ('test-order', $1, 'grain', 10, 'Port-A', 1, '2030-01-01T00:00:00Z')`,
      [seededUser.rows[0].user_id],
    );
    await assert.rejects(
      pool.query("UPDATE orders SET priority = 4 WHERE order_id = 'test-order'"),
      (error) => error.code === "23514",
    );
  },
);

after(async () => {
  if (pool && schema) {
    const cleanupPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await cleanupPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await cleanupPool.end();
    await pool.end();
  }
});
