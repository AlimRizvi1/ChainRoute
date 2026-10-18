import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";

type FixtureWagon = {
  wagonId: string;
  capacityTonnes: number;
  wagonType: string;
  location: string;
  available: boolean;
};

type FixtureRoute = {
  routeId: string;
  origin: string;
  destination: string;
  distanceKm: number;
  transitTimeSeconds: number;
};

type MasterDataFixture = {
  wagons: FixtureWagon[];
  routes: FixtureRoute[];
};

const DEMO_USERS = [
  {
    username: "demo.shipper",
    role: "Shipper",
    chainAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  },
  {
    username: "demo.carrier",
    role: "Carrier",
    chainAddress: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  },
  {
    username: "demo.administrator",
    role: "Administrator",
    chainAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  },
  {
    username: "demo.auditor",
    role: "Auditor",
    chainAddress: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  },
] as const;

function stableUserId(username: string): string {
  const bytes = createHash("sha256")
    .update(`chainroute:phase15:demo-user:${username}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getMasterDataSeedPath(): string {
  return (
    process.env.MASTER_DATA_SEED_PATH ??
    resolve(__dirname, "../../../samples/plentiful-dataset.json")
  );
}

async function readFixture(path: string): Promise<MasterDataFixture> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!raw || typeof raw !== "object" || !("wagons" in raw) || !("routes" in raw)) {
    throw new Error("Master data fixture must contain wagon and route lists.");
  }
  const fixture = raw as Partial<MasterDataFixture>;
  if (!Array.isArray(fixture.wagons) || !Array.isArray(fixture.routes)) {
    throw new Error("Master data fixture contains invalid wagon or route lists.");
  }
  return fixture as MasterDataFixture;
}

export async function seedDemoData(
  pool: Pool,
  fixturePath = getMasterDataSeedPath(),
): Promise<{ users: number; wagons: number; routes: number }> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo data seeding is disabled in production.");
  }
  const fixture = await readFixture(fixturePath);
  const client = await pool.connect();
  const added = { users: 0, wagons: 0, routes: 0 };

  try {
    await client.query("BEGIN");

    for (const user of DEMO_USERS) {
      const result = await client.query(
        `INSERT INTO users (user_id, username, role, chain_address)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (username) DO NOTHING`,
        [stableUserId(user.username), user.username, user.role, user.chainAddress],
      );
      added.users += result.rowCount ?? 0;
    }

    for (const wagon of fixture.wagons) {
      const result = await client.query(
        `INSERT INTO wagons (wagon_id, capacity_tonnes, wagon_type, location, available)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (wagon_id) DO NOTHING`,
        [
          wagon.wagonId,
          wagon.capacityTonnes,
          wagon.wagonType,
          wagon.location,
          wagon.available,
        ],
      );
      added.wagons += result.rowCount ?? 0;
    }

    for (const route of fixture.routes) {
      const result = await client.query(
        `INSERT INTO routes (route_id, origin, destination, distance_km, transit_time_seconds)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (route_id) DO NOTHING`,
        [
          route.routeId,
          route.origin,
          route.destination,
          route.distanceKm,
          route.transitTimeSeconds,
        ],
      );
      added.routes += result.rowCount ?? 0;
    }

    await client.query("COMMIT");
    return added;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
