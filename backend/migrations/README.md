# Backend database schema and migrations

Phase 15 uses PostgreSQL 16, the existing `pg` connection pool, and numbered, immutable SQL migrations. `npm run db:migrate` applies missing migrations in order. The migration runner uses a PostgreSQL advisory transaction lock, checks each recorded SHA-256 before skipping it, refuses edited or out-of-order migrations, and commits a schema migration and its ledger row in the same transaction. On a fresh local database, backend startup runs migration and seed automatically. To deliberately rebuild only the Track 3 data in the dedicated local `chainroute` database, run `npm run db:reset` from `backend/`; it drops only the platform's tables, then reapplies migrations and the approved seed in one command. The guard refuses production and other database names/hosts. Do not point it at shared or production data.

The seed uses `samples/plentiful-dataset.json`, the approved Phase 3 generator output. It imports wagon and route master records and creates one stable demo account for each frozen role. Order fixtures are intentionally not inserted: current plan deadlines and ownership would present stale orders as live work. User and master-data inserts use unique IDs and `ON CONFLICT DO NOTHING`; seed never updates or replaces existing rows. `npm run db:seed` can be repeated. It requires the database owner to have already applied the schema.

The four usernames are `demo.shipper`, `demo.carrier`, `demo.administrator`, and `demo.auditor`. They use the local `DEMO_USER_PASSWORD` configured in the ignored root `.env`; each database row stores an independent salted scrypt hash, never the password. Seed sets a missing demo hash but will not replace an existing hash. Demo seed is disabled in production. Their chain addresses mirror deterministic Hardhat accounts; private keys are not stored in PostgreSQL. Phase 18 must authorize a safe signer mapping before real chain writes. Do not use these identities in a publicly exposed deployment.

| Table | Purpose and relationships |
|---|---|
| `schema_migrations` | Created by the runner. Records the ordered filename, integer version, content checksum, and application timestamp. |
| `users` | Stable platform identity, the frozen role, optional unique on-chain address mapping, an scrypt password hash, activation flag, and timestamps. Orders, plans, contracts, audit entries reference users. |
| `wagons`, `routes` | Platform-owned optimizer master data seeded from the checked Track 1 fixture. Positive capacity/distance/duration checks and active flags preserve retired references. |
| `optimization_runs` | Track 1 run ID, input hash and optional input snapshot, returned metadata, lifecycle/outcome, error snapshot, duration, and timestamps. The platform may retain diagnostic linkage while Track 1 remains owner of its SQLite trace. |
| `orders` | Shipper-owned freight input, priority and deadline with pending/planned state. Positive quantity and valid priority are enforced in PostgreSQL. A trigger rejects edits after the plan locks the order. |
| `allocation_plans` | Immutable JSON result plus the originating successful run ID and creator. Every plan links to one unique run. |
| `plan_orders` | Join table linking a plan to every order included in its input and preserving whether that order was assigned. Unique order linkage prevents the same locked order silently entering a second run. |
| `contracts` | Cached on-chain lifecycle state and immutable plan/party/terms/assignment snapshot, monetary values in integer paise, and cache reconciliation markers. The plan has at most one contract. |
| `contract_events` | Ordered event/history cache. The on-chain transaction/log position is unique when present, so event replay can be idempotent. |
| `delivery_events` | Shipment milestones and delivery proof, timestamps, actor and confirmed SLA result. Platform persists chain-returned values without recomputing money. |
| `payments` | One accounting settlement per contract, gross/deduction/net paise and optional on-chain transaction reference, with release/closure ordering. A database check makes the figures reconcile. |
| `audit_trail` | Append-oriented actor, action/resource reference, timestamp, outcome and minimal structured details. Phase 16 supplies the authenticated actor and write hooks. Never store credentials or secrets here. |

Principal relationships:

```text
users ──< orders >── plan_orders ──> allocation_plans ──> optimization_runs
  │                                         │
  └──────── contract parties ───────────> contracts ──< contract_events
                                           │          └─< delivery_events
                                           └────────────> payments
  └────────────────────────────────────────────────────> audit_trail
```

IDs returned over HTTP remain opaque strings. Platform order IDs use UUID-shaped strings. Track 1 run and plan IDs remain its opaque string values. Contract IDs remain decimal strings matching Track 2's `uint256`. Amounts are `numeric(78, 0)` paise in PostgreSQL, decimal strings at the JSON boundary, and never JavaScript floating-point values.

Phase 15 explicitly defers cross-track key custody to Phase 18 and the privacy conflict about auditor access to contract terms to a team decision. The event cache schema anticipates replay by chain transaction/log position without claiming that event synchronization is implemented in this phase.

## Authentication configuration

Copy `.env.example` to the ignored root `.env`, then set `AUTH_TOKEN_SECRET` and `DEMO_USER_PASSWORD` to unique random values. The backend uses a 15-minute bearer token; a local process can generate an ephemeral signing secret when none is provided, while production refuses to start without a configured secret of at least 32 bytes. `npm run db:reset` and backend startup load the root `.env` when run locally from `backend/`; Compose injects the values into the container. Never commit or share `.env`.

## Phase 15 verification

Run `npm test` from `backend/`. The PostgreSQL integration test creates and drops a temporary uniquely named schema so it does not touch platform data in `public`; provide a dedicated local PostgreSQL connection with permission to create schemas in `TEST_DATABASE_URL` to run it. Without that variable, the schema integration test is explicitly skipped, while migration-file ordering/name and local-reset safety unit checks still run. For example, in PowerShell, set `$env:TEST_DATABASE_URL` to a dedicated ChainRoute development database before running the test, then remove that variable when finished. Do not include live credentials in source control or logs.
