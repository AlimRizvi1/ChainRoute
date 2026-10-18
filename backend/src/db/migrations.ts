import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Pool } from "pg";

const ADVISORY_LOCK_ID = "7542101501";
const MIGRATION_NAME = /^(\d{3,})_([a-z0-9][a-z0-9_-]*)\.sql$/;

type Migration = {
  version: number;
  name: string;
  path: string;
};

export function getMigrationsDirectory(): string {
  return process.env.MIGRATIONS_DIR ?? resolve(__dirname, "../../migrations");
}

export async function discoverMigrations(directory: string): Promise<Migration[]> {
  const filenames = (await readdir(directory)).filter((name) => name.endsWith(".sql"));
  const migrations = filenames.map((name): Migration => {
    const match = MIGRATION_NAME.exec(name);
    if (!match) {
      throw new Error(`Invalid migration filename: ${name}`);
    }
    return {
      version: Number(match[1]),
      name,
      path: join(directory, name),
    };
  });
  migrations.sort((left, right) => left.version - right.version);

  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index];
    if (
      !Number.isSafeInteger(migration.version) ||
      migration.version !== index + 1 ||
      (index > 0 && migration.version === migrations[index - 1].version)
    ) {
      throw new Error(
        `Migration versions must be unique and contiguous from 001; found ${migration.name}.`,
      );
    }
  }

  if (migrations.length === 0) {
    throw new Error(`No SQL migrations were found in ${directory}.`);
  }
  return migrations;
}

export async function runMigrations(
  pool: Pool,
  directory = getMigrationsDirectory(),
): Promise<string[]> {
  const migrations = await discoverMigrations(directory);
  const client = await pool.connect();
  const newlyApplied: string[] = [];

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
      ADVISORY_LOCK_ID,
    ]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version integer PRIMARY KEY CHECK (version > 0),
        name text NOT NULL UNIQUE,
        checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await client.query<{
      version: number;
      name: string;
      checksum: string;
    }>("SELECT version, name, checksum FROM schema_migrations ORDER BY version");
    const applied = appliedResult.rows;
    for (let index = 0; index < applied.length; index += 1) {
      if (Number(applied[index].version) !== index + 1) {
        throw new Error(
          `Migration history has a gap or was applied out of order at ${applied[index].name}.`,
        );
      }
    }

    for (const migration of migrations) {
      const existing = applied.find(
        (entry) => Number(entry.version) === migration.version,
      );
      const source = await readFile(migration.path);
      const checksum = createHash("sha256").update(source).digest("hex");

      if (existing) {
        if (existing.name !== migration.name || existing.checksum !== checksum) {
          throw new Error(
            `Applied migration ${migration.name} was renamed or edited; add a new migration instead.`,
          );
        }
        continue;
      }

      if (migration.version <= applied.length) {
        throw new Error(
          `Migration ${migration.name} is out of order; migration history is inconsistent.`,
        );
      }

      await client.query(source.toString("utf8"));
      await client.query(
        "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
        [migration.version, migration.name, checksum],
      );
      newlyApplied.push(migration.name);
    }

    await client.query("COMMIT");
    return newlyApplied;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
