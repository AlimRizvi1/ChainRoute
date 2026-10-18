import { Pool } from "pg";
import { runMigrations } from "./migrations.js";
import { resetLocalTrack3Database, assertSafeLocalReset } from "./reset.js";
import { seedDemoData } from "./seed.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://chainroute:chainroute-local@127.0.0.1:5432/chainroute";
const command = process.argv[2];
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

async function main(): Promise<void> {
  switch (command) {
    case "migrate": {
      const applied = await runMigrations(pool);
      console.log(
        applied.length === 0
          ? "Database schema is already current."
          : `Applied migrations: ${applied.join(", ")}`,
      );
      return;
    }
    case "seed": {
      const added = await seedDemoData(pool);
      console.log(
        `Seeded new rows: ${added.users} users, ${added.wagons} wagons, ${added.routes} routes.`,
      );
      return;
    }
    case "setup": {
      const applied = await runMigrations(pool);
      const added = await seedDemoData(pool);
      console.log(
        `Database ready; ${applied.length} migration(s) applied and ${added.users} users, ${added.wagons} wagons, ${added.routes} routes added.`,
      );
      return;
    }
    case "reset": {
      assertSafeLocalReset(databaseUrl);
      await resetLocalTrack3Database(pool);
      const applied = await runMigrations(pool);
      const added = await seedDemoData(pool);
      console.log(
        `Local Track 3 database rebuilt; ${applied.length} migration(s) applied and ${added.users} users, ${added.wagons} wagons, ${added.routes} routes added.`,
      );
      return;
    }
    default:
      throw new Error("Use one of: migrate, seed, setup, reset.");
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Database operation failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
