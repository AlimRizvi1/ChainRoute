import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { createPlatformApp } from "./app.js";
import { runMigrations } from "./db/migrations.js";
import { seedDemoData } from "./db/seed.js";
import { loadWorkspaceEnv } from "./env.js";

loadWorkspaceEnv();

const port = Number(process.env.PORT ?? "8080");
const dependencyTimeoutMs = Number(
  process.env.DEPENDENCY_TIMEOUT_MS ?? "5000",
);
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://chainroute:chainroute-local@database:5432/chainroute";

function getTokenSecret(): string {
  const configured = process.env.AUTH_TOKEN_SECRET;
  if (process.env.NODE_ENV === "production" && !configured) {
    throw new Error("AUTH_TOKEN_SECRET must be configured in production.");
  }
  if (configured && Buffer.byteLength(configured, "utf8") < 32) {
    throw new Error("AUTH_TOKEN_SECRET must contain at least 32 UTF-8 bytes.");
  }
  return configured ?? randomBytes(32).toString("base64url");
}

async function start(): Promise<void> {
  const database = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: dependencyTimeoutMs,
    statement_timeout: dependencyTimeoutMs,
    max: 4,
  });
  const app = await createPlatformApp({
    database,
    tokenSecret: getTokenSecret(),
    dependencyTimeoutMs,
    logLevel: process.env.LOG_LEVEL,
  });

  try {
    const applied = await runMigrations(database);
    if (applied.length > 0) {
      app.log.info({ migrations: applied }, "Database migrations applied");
    }
    if (process.env.NODE_ENV !== "production") {
      const seeded = await seedDemoData(database);
      if (Object.values(seeded).some((count) => count > 0)) {
        app.log.info({ seeded }, "Local demo data added");
      }
    }
    await app.listen({ host: "0.0.0.0", port });
  } catch (error) {
    app.log.error({ err: error }, "Backend initialization failed");
    await app.close().catch(() => undefined);
    process.exitCode = 1;
  }
}

void start();
