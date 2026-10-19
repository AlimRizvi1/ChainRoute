import type { Pool } from "pg";

const RESET_TABLES = [
  "account_invitations",
  "chain_sync_state",
  "contract_operations",
  "contract_events",
  "delivery_events",
  "payments",
  "contracts",
  "plan_orders",
  "allocation_plans",
  "orders",
  "optimization_runs",
  "audit_trail",
  "routes",
  "wagons",
  "users",
  "schema_migrations",
];

export function assertSafeLocalReset(
  connectionString: string,
  nodeEnv = process.env.NODE_ENV,
): void {
  if (nodeEnv === "production") {
    throw new Error("Database reset is disabled in production.");
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Database reset needs a valid local DATABASE_URL.");
  }

  const hostIsLocal = ["localhost", "127.0.0.1", "database"].includes(url.hostname);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!hostIsLocal || databaseName !== "chainroute") {
    throw new Error(
      "Database reset is limited to the dedicated local 'chainroute' database.",
    );
  }
}

export async function resetLocalTrack3Database(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const table of RESET_TABLES) {
      await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    await client.query("DROP FUNCTION IF EXISTS prevent_locked_order_update() CASCADE");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
