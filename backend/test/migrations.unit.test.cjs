const assert = require("node:assert/strict");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { discoverMigrations } = require("../dist/db/migrations.js");
const { assertSafeLocalReset } = require("../dist/db/reset.js");
const { getMasterDataSeedPath } = require("../dist/db/seed.js");

test("migration discovery sorts padded versions and requires a continuous history", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chainroute-migrations-"));
  try {
    await writeFile(path.join(directory, "002_second.sql"), "SELECT 2;");
    await writeFile(path.join(directory, "001_first.sql"), "SELECT 1;");
    assert.deepEqual(
      (await discoverMigrations(directory)).map(({ name }) => name),
      ["001_first.sql", "002_second.sql"],
    );

    await rm(path.join(directory, "001_first.sql"));
    await assert.rejects(
      discoverMigrations(directory),
      /contiguous from 001/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("migration filenames must be explicit and safe", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chainroute-migrations-"));
  try {
    await writeFile(path.join(directory, "001_init.SQL"), "SELECT 1;");
    await assert.rejects(discoverMigrations(directory), /No SQL migrations/);

    await writeFile(path.join(directory, "001_initial schema.sql"), "SELECT 1;");
    await assert.rejects(discoverMigrations(directory), /Invalid migration filename/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("database reset refuses production and databases outside the local project", () => {
  assert.doesNotThrow(() =>
    assertSafeLocalReset(
      "postgresql://chainroute:local@127.0.0.1:5432/chainroute",
      "development",
    ),
  );
  assert.doesNotThrow(() =>
    assertSafeLocalReset(
      "postgresql://chainroute:local@database:5432/chainroute",
      "development",
    ),
  );
  assert.throws(
    () =>
      assertSafeLocalReset(
        "postgresql://chainroute:local@database:5432/chainroute",
        "production",
      ),
    /disabled in production/,
  );
  assert.throws(
    () =>
      assertSafeLocalReset(
        "postgresql://chainroute:local@db.example.org:5432/chainroute",
        "development",
      ),
    /dedicated local/,
  );
  assert.throws(
    () =>
      assertSafeLocalReset(
        "postgresql://chainroute:local@127.0.0.1:5432/not-chainroute",
        "development",
      ),
    /dedicated local/,
  );
});

test("default master-data seed path points to the approved root fixture", async () => {
  const fixture = getMasterDataSeedPath();
  const { readFile } = require("node:fs/promises");
  const dataset = JSON.parse(await readFile(fixture, "utf8"));
  assert.equal(path.basename(fixture), "plentiful-dataset.json");
  assert.ok(dataset.wagons.length > 0);
  assert.ok(dataset.routes.length > 0);
});
