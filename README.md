# ChainRoute

AI-optimized freight allocation with blockchain-based smart contracts.

ChainRoute helps allocate freight orders to rail wagons and routes, then manages carrier agreements and shipment settlement. See the [technical development plan](docs/Plan.md) for the full scope, requirements, architecture, and phase acceptance criteria.

## Team

The plan is organized for three students, with one owner per workstream.

| Team member | Name | Workstream |
|---|---|---|
| Alim | Alim | Track 1 — AI/ML Allocation Engine |
| Parth | Parth | Track 2 — Blockchain Settlement Layer |
| Elish | Elish | Track 3 — Platform (Backend API + Dashboard) |

Elish owns both the backend API and dashboard, as Track 3 is defined in the plan. Foundation and integration work is shared by all three members.

## Getting started

The foundation is underway: Alim's local Phase 0 checks have passed, while Parth's and Elish's machine checks remain pending. Phase 1 contracts, decisions, and sample data are complete and approved by all three members. Each member should:

1. Install and verify Python 3.12+, Node.js 22 with npm 10+, Docker Desktop with Compose v2, and Git.
2. Clone the repository and confirm they can create and push a branch.
3. Run a temporary hello-world check in their assigned track's language, then remove it.
4. Confirm a local PostgreSQL container can start and answer a query.
5. Record working tool versions and evidence in the progress tracker below.

### Run the complete local prototype

Docker Desktop with Compose v2 is required. The defaults are for local development only. Copy the example environment file, set a generated AUTH_TOKEN_SECRET (at least 32 bytes) and DEMO_USER_PASSWORD, and customize PostgreSQL credentials/ports as needed:

```powershell
Copy-Item .env.example .env
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-demo.ps1
```

When the services report healthy, open the dashboard at <http://localhost:5173>. The backend health endpoint is <http://localhost:8080/health>; Track 1 is at <http://localhost:8000/health>, and the local JSON-RPC node is at <http://localhost:8545>.

### Open the populated frontend demo

Open <http://localhost:5173/login> and sign in as **demo.shipper** using `DEMO_USER_PASSWORD` from your existing root `.env`. The demo setup creates **six pending synthetic orders and four contracts**, including an agreement ready for booking, shipments in transit, a payment-ready delivery, and a closed late settlement. All four demo roles use the same configured local demo password.

Use **Allocations** to run the queued orders, **Contracts** for tracking and settlement, **demo.carrier** to book/dispatch, and **demo.administrator** to release/close the payment-ready contract. Freight orders opens its own database-backed register with Pending/Planned filters and a new-order form; Audit trail now has its own action history with actor/action/outcome filters. Saved plans reopens previous runs, and Administrators can maintain wagons/routes and provision local signing wallets. See [frontend demo guide](docs/frontend-demo.md).

**Freight register and AI lab:** open <http://localhost:5173/orders> for all your persisted freight, including already-Planned orders. Open <http://localhost:5173/ai-lab> from any role to run the live CP-SAT/greedy comparison, vary ML cargo/deadline slack, inspect requests and model identity, and read the saved synthetic accuracy report. Allocations also explains how the returned engine and prediction method contributed to its plan. The lab uses fixed teaching cases and does not consume your order queue. See the [teacher walkthrough](docs/frontend-demo.md).

```powershell
# Populate synthetic demo records through the real API; preserves existing data.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/seed-frontend-demo.ps1
```

**Blockchain showcase:** open <http://localhost:5173/blockchain> from any role. The first window starts at **Genesis (block #0)**, which stays accessible while paging forward/backward or switching to the latest blocks. Full dates, years, seconds and UTC/IST selection display the node's original timestamps, including synthetic shipment-clock advances. Replay preserves those dates; animated parent links and block entries explain how the ledger grows. Administrators can add a local empty demonstration block.

**Animated AI walkthroughs:** the CP-SAT & ML lab now illustrates the scarce-wagon conflict, feasible alternative allocation and final live-engine assignments. The Logistic Regression view follows real model features, learned contributions, logit and sigmoid to the returned probability. Both support pause/play, individual steps, replay, speed and motion controls; reduced-motion and hidden/offscreen states are handled. The candidate walkthrough is a teaching explanation, not a captured internal solver trace. See [interactive demonstration guide](docs/interactive-visualizations.md).

On this workstation, Docker PostgreSQL uses **localhost:55432 / chainroute_live**. The former **chainroute** database remains archived in the same volume; see the demo guide for the transition from the former volatile ledger.

### Create an account and sign in

Select **Create an account** on the login screen, or visit <http://localhost:5173/signup>. Public registration creates a **Shipper** account with its own username and password. Usernames contain 3–64 letters, numbers, dots, underscores, or hyphens, begin with a letter or number, and are unique without regard to case. Passwords require at least 12 characters and accept up to 256 UTF-8 bytes without truncation. Login ignores username case and surrounding whitespace.

For **Carrier**, **Auditor**, or **Administrator** access, an existing Administrator opens **Administration → People & access**, chooses the intended role, and creates an invitation link. The link is shown once, expires after 24 hours, can be revoked, and can be redeemed by one new account. Share it directly with the intended person; the application does not send email. The server determines the account role, so a signup request cannot choose its own elevated permissions. Administrators can enable or disable accounts; disabled accounts are rejected on their next protected request and cannot log in. Administrators cannot disable their own account.

The four local `demo.*` accounts still use the ignored root `.env` value `DEMO_USER_PASSWORD`. Newly registered accounts use the password chosen during signup. Account registration does not configure an on-chain identity: an Administrator can assign an unused local Shipper/Carrier signing wallet from People & access. Production requires a trusted wallet mapping and matching runtime signer as described in [database/auth configuration](backend/migrations/README.md). This prototype uses username/password registration and 15-minute access tokens; email verification, self-service password recovery, and refresh tokens are not implemented. Sample/mock mode does not create real accounts.

The AI optimize endpoint is `POST http://localhost:8000/v1/optimize`; it validates the shared request contract and returns a deterministic, deadline-feasible CP-SAT allocation ranked with the Phase 5 objective. The optional `timeBudgetSeconds` defaults to 1 second and is bounded from 0.05 to 10 seconds. The deployed `ChainRouteSettlement` contract address and ABI can be inspected at <http://localhost:8080/blockchain/contract>. To submit an optimized sample plan as an on-chain agreement, run `docker compose --profile track2-bridge run --rm track2-bridge`.

### Track 1 data generation and validation

Regenerate the deterministic 25-order `plentiful` and `scarce` datasets with `python ai-engine/generate_samples.py`; the defaults use seed `1`. The data rules and batch-validation result format are documented in the [synthetic data contract](docs/contracts/synthetic-data.md). Run the Track 1 tests with:

```powershell
python -m unittest discover -s ai-engine -p "test_*.py"
```

To stop the services while keeping persistent data, use `docker compose down`. To remove the PostgreSQL, deployed-contract, and AI run-log volumes and prove a clean restart, use `docker compose down -v` followed by `docker compose up --build`.

Backend dependency probes are bounded by `DEPENDENCY_TIMEOUT_MS` (5 seconds by default); the dashboard allows up to 9 seconds for a health response. If a dependency is stopped or responds too slowly, `/health` stays HTTP 200 and reports `status: degraded` plus the down service. The dashboard refreshes automatically and shows textual and color-coded service states.

Retrain Track 1's deterministic synthetic on-time model after changing its simulation assumptions or training data:

```powershell
python -m pip install -r ai-engine/requirements.txt
python ai-engine/train_prediction_model.py
```

The generated model artifact records its content-derived version and held-out metrics. The current synthetic validation MAE is 0.0098 against the 0.10 tolerance; this measures fit to the simulator, not real-world delivery performance.

Each optimize call writes one success/failure trace to the AI engine's SQLite database. Compose persists the database in the `ai-run-logs` volume. Retrieve a trace by its returned run ID with `GET http://localhost:8000/v1/runs/{runId}`.

### Demonstrate the ML model and view accuracy

Open <http://localhost:8000/demo/> for live model predictions, input/output JSON, run audit records, and a reproduced evaluation table with its confusion matrix. No platform login is required for this local AI-engine demonstration. The [teacher demonstration guide](docs/ml-demo.md) includes a three-minute walkthrough, an explanation to read aloud, source-file links, and reproduction commands. Interactive API documentation is at <http://localhost:8000/docs>.

The frozen logistic regression model achieves **97.35% classification accuracy** on **6,000 held-out synthetic examples**, versus **90.92%** for the always-on-time baseline; late-delivery recall is **81.65%**. Probability MAE is **0.0097755** and Brier score is **0.0191757**. These are simulation results, not real railway accuracy. The demo uses the engine's fixed January 2026 synthetic clock. Grain scenarios with zero, one, and two hours of deadline slack return **51.81%**, **88.30%**, and **98.15%** probability. OR-Tools CP-SAT is the allocation optimizer, separate from the one trained ML model.

### Track 2 contract workspace

The pinned Hardhat workspace compiles with Solidity 0.8.28. Install its dependencies once with `npm ci` from `blockchain/`. Start a local chain in one terminal:

```powershell
npm run node
```

Then compile, test, and deploy from a second terminal in `blockchain/`:

```powershell
npm run compile
npm test
npm run deploy:local
```

The deploy command intentionally deploys a fresh contract each time and overwrites `blockchain/deployments/local.json` with its address, ABI, and chain ID. Set `CONTRACT_OUTPUT_PATH` to choose another output path; Docker Compose sets it to the shared artifact path consumed by the backend. Phase 9 verified the Hardhat deployment loop and test helpers; Phase 10 replaces the temporary probe with the agreement and booking lifecycle.

To verify portability against a second fresh local network, start another node on port 8546, then run the unchanged suite with only the RPC URL redirected:

```powershell
# Terminal 1, from blockchain/
npx hardhat node --hostname 127.0.0.1 --port 8546

# Terminal 2, from blockchain/
$env:CHAIN_RPC_URL = "http://127.0.0.1:8546"
npm test -- --network local
Remove-Item Env:CHAIN_RPC_URL
```

### Run the integration validation

The integration validation uses a dedicated Docker project with its own volumes and ports, so it never resets the ordinary development stack. From the repository root:

```powershell
# Full end-to-end integration: two settlement scenarios, failure drills, SPA routes
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-integration.ps1

# Full acceptance: integration + all four test suites + blockchain portability
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-acceptance.ps1

# Reset only: clean validation demo for manual walkthrough
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-integration.ps1 -ResetOnly
```

Open <http://localhost:15173> after a reset. Credentials are in ignored `artifacts/integration/.env.validation`. Evidence is written to `artifacts/integration/report.json` and `acceptance.json`. See [integration-validation](docs/integration-validation.md) for the full assertion list, evidence format, and manual recording checklist.

## Project layout

```text
ai-engine/          Track 1 — Python allocation service, data generator and validators
blockchain/         Track 2 — Solidity contracts and deployment
backend/            Track 3 — TypeScript API
dashboard/          Track 3 — TypeScript web UI
samples/            Phase 1 API examples and Phase 3 synthetic datasets
scripts/            Integration and acceptance validation scripts
docs/
  contracts/        Cross-track schemas and synthetic-data rules
  integration-validation.md  Phase 26–27 evidence and manual checklist
  decisions.md      Team decisions for the plan
  Plan.md           Full technical development plan
docker-compose.yml  Local walking skeleton (Phase 2)
```

## Progress tracker

Update this table as work is completed. Set a phase to **In progress** only when someone has started it, and to **Done** only when its acceptance criteria in [the plan](docs/Plan.md) are met. Add a short link, test result, or commit in **Evidence / notes** so the other two members can verify progress.

### Foundation and team setup

| Phase | Work | Owner | Status | Evidence / notes |
|---|---|---|---|---|
| 0 | Toolchain and workspace setup | All three | In progress — Alim's local checks complete; team checks pending | Alim: Python 3.13.2, Node.js 22.22.3, npm 11.8.0, Docker 29.8.2 / Compose v5.6.0, Git 2.49.0; Python HTTP returned 200, Node hello-world ran, Docker hello-world passed, PostgreSQL 16 `SELECT 1` passed. Parth/Elish machine checks and shared clone/push verification remain. |
| 1 | Interface contracts and sample data freeze | All three | Done — all three approvals confirmed | [AI engine schema](docs/contracts/ai-engine.schema.json), [Platform OpenAPI](docs/contracts/platform.openapi.yaml), [Blockchain contract and ABI](docs/contracts/blockchain.md); [sample payloads](samples/). All three members' approvals recorded in [decision log](docs/decisions.md); schemas and examples validated. |
| 2 | Walking skeleton | All three | Done | Clean `docker compose down -v` then `docker compose up --build --detach`: AI, Hardhat chain, PostgreSQL, backend, and dashboard healthy; one-shot contract deployer exited 0 and recreated the artifact. Verified exact canned optimize response, field-specific 400s, deployed on-chain code, all-up health, AI/database/two-service outage and recovery, dashboard status labels/colors, and a slow dependency timing out as down. |

### Track 1 — AI/ML Allocation Engine

| Phase | Work | Owner | Status | Evidence / notes |
|---|---|---|---|---|
| 3 | Synthetic data generation and input validation | Alim | Done | [24 automated tests](ai-engine/test_synthetic_data.py) pass, including 50 seeds for both capacity scenarios and generated-record validation. Reproducible 25-order fixtures: [plentiful](samples/plentiful-dataset.json), [scarce](samples/scarce-dataset.json); rules and decisions: [synthetic-data contract](docs/contracts/synthetic-data.md), [decision log](docs/decisions.md). |
| 4 | Rule-based allocation agent (baseline) | Alim | Done | All [15 allocator tests](ai-engine/test_allocator.py) and [24 Phase 3 regression tests](ai-engine/test_synthetic_data.py) pass; 50 seeds each of plentiful/scarce data satisfy assignment invariants. Live `/v1/optimize` returns schema-shaped deadline-feasible allocations, preserves field-level 400 errors, and matches the sample request's expected wagon assignments. Baseline rules are documented in the [allocation contract](docs/contracts/allocation-baseline.md); Phase 5 supplies the finalized metrics and scoring. |
| 5 | Objective scoring, weighting, and ranking | Alim | Done | All 52 AI-engine tests pass across [HTTP validation](ai-engine/test_api.py), [hand-built ranking cases](ai-engine/test_ranking.py), [Phase 4 allocation invariants](ai-engine/test_allocator.py), and [Phase 3 data validation](ai-engine/test_synthetic_data.py). Verified the API's field-specific 400 for a negative weight; hand-calculated 66.67% utilization and 75,000-paise cost; weight-driven what-if route changes; and distinct ranked alternatives. Scoring rules and approved cost/coverage decisions are recorded in the [AI engine contract](docs/contracts/ai-engine.md) and [decision log](docs/decisions.md); see the updated [response sample](samples/allocation-plan.json). |
| 6 | Optimization agent (constraint-based search) | Alim | Done | All 59 AI-engine tests pass: [search/ranking](ai-engine/test_ranking.py), [HTTP validation](ai-engine/test_api.py), [allocation invariants](ai-engine/test_allocator.py), and [synthetic-data validation](ai-engine/test_synthetic_data.py). Verified the 300-order plentiful target and 1-second scarce-budget case. Deterministic single-worker CP-SAT prioritizes order classes, uses the baseline as a warm start/fallback, and returns schema-valid plans. The [saved scarce demo](samples/phase-6-scarce-demo.json) raises assignments from 1 to 2 and plan on-time probability from 0.490 to 0.958 versus the Phase 4 baseline. The budget and new `INCOMPATIBLE_WAGON_TYPE` reason are recorded in the [AI engine contract](docs/contracts/ai-engine.md). |
| 7 | Machine-learning prediction component | Alim | Done | All 69 AI-engine tests pass. Deterministic logistic regression uses 30,000 synthetic lognormal transit outcomes and a stratified 80/20 split (seed 42); held-out probability MAE is 0.0098 (≤ 0.10 tolerance). Boundary, monotonicity, determinism, unseen-cargo and missing-model fallback, ranking integration, and 300-order prediction performance are covered; 300 predictions measured 0.0010 s. Model version is content-derived; see [prediction contract](docs/contracts/ai-engine.md), [training command](ai-engine/train_prediction_model.py), and [decision log](docs/decisions.md). Added a [live teaching demo](http://localhost:8000/demo/) and [reproducible evaluation](docs/ml-demo.md): 97.35% classification accuracy on 6,000 synthetic holdout examples, 90.92% baseline, 81.65% late recall; 14 focused ML/API tests pass and three live predictions/traces match the frozen artifact. |
| 8 | Traceability, logging, and performance validation | Alim | Done | Every optimize success and failure gets one unique SQLite run record containing the full input snapshot/hash, timestamps/runtime, algorithm parameters, prediction/model version, input counts, plan ID, and failure diagnostics; `GET /v1/runs/{runId}` retrieves it. Concurrent run writes, duplicate-ID rejection, input/what-if traceability, and failure logging are tested. Full 300-order runs including ML, ranking, response validation, and SQLite logging: plentiful **7.056 s**, scarce **3.274 s** (seed 11); both returned complete plans. Track 1 is independently runnable without Track 2/3. The AI engine Docker image built successfully; its container passed health and optimize/retrieve checks, and its SQLite run record survived a container restart in the named volume. See the [run-log/API contract](docs/contracts/ai-engine.md) and [storage decision](docs/decisions.md). |

### Track 2 — Blockchain Settlement Layer

| Phase | Work | Owner | Status | Evidence / notes |
|---|---|---|---|---|
| 9 | Smart contract workspace and deployment pipeline | Parth | Done | Pinned Solidity 0.8.28/Hardhat toolchain; compile, test, and local deployment verified. The temporary setter/time-travel probe was removed when Phase 10 introduced the settlement contract; deployment intentionally creates a fresh contract and overwrites the local artifact. |
| 10 | Agreement creation and booking | Parth | Done | `ChainRouteSettlement` implements the frozen state order, operator-only creation, assigned-carrier booking, terms/hash storage, events, and on-chain chronological history. Phase 10 Hardhat tests cover creation, IDs, hash consistency, authorization, invalid terms, booking, reads, isolation, zero IDs, and same-party accounts. Validation: [blockchain contract](docs/contracts/blockchain.md), [decision 15](docs/decisions.md). |
| 11 | Transit status tracking and event log | Parth | Done | 9 Phase 11 Hardhat tests pass; all 12 Phase 10 regressions still pass. Verified carrier-only status updates, frozen status values, `Booked` → `InTransit` on first update, monotonic timestamps with equal timestamps allowed, and matching events plus append-only chronological history. |
| 12 | Delivery confirmation, SLA evaluation, penalty, and demurrage | Parth | Done | All 28 blockchain Hardhat tests pass, including all eight penalty/demurrage vectors. Verified SLA boundaries, started-block and billable-hour rounding, delivery/POD/state/timestamp rejection, first-arrival timing, combined deduction cap, and ordered delivery/penalty/demurrage events with history. Decisions are recorded in [decision 17](docs/decisions.md). |
| 13 | Settlement and contract closure | Parth | Done | All 38 blockchain Hardhat tests pass. Verified net payouts of 2,326,000 (vector F), 2,500,000 (vector A), and 0 (vector H); operator authorization, release/close state guards, no duplicate release, terminal-state enforcement, and full ordered event/history walkthrough. See [decision 18](docs/decisions.md). |
| 14 | Dispute resolution, audit interface, and portability | Parth | Done | All 49 Hardhat tests pass on the default network and unchanged on a fresh second local node at port 8546, with only `CHAIN_RPC_URL` redirected. Verified all dispute outcomes, release blocking, role/identity checks, repeated pre-release disputes, party/arbitrator overlap, and preserved history. Implementation decisions are in [decision 19](docs/decisions.md). |

### Track 3 — Platform (Backend API + Dashboard)

| Phase | Work | Owner | Status | Evidence / notes |
|---|---|---|---|---|
| 15 | Backend foundation: persistence and migrations | Elish | Done | Added the PostgreSQL schema and checksum-locked migration runner; startup applies migrations and safely seeds four role demo users plus Track 1 wagons/routes. `npm run db:reset` rebuilds only the dedicated local `chainroute` database and refuses production or a different target. Added schema/relationship documentation and an isolated integration suite. All 5 tests pass against PostgreSQL, including migration ordering/idempotency, constraints, foreign keys, repeatable seeding, and preserving edited master data; rerun in Node 22 through the Compose network. Verified `npm run db:reset` on an isolated local database: 1 migration, 4 users, 119 wagons, 4 routes. `docker compose config --quiet`, `docker compose build backend`, and `git diff --check` pass. A high-severity advisory affecting the original Fastify 5.2.1 dependency was resolved in Phase 16; the current production dependency audit reports zero vulnerabilities. Proposed persistence decisions are recorded in [decision 20](docs/decisions.md) for team review. |
| 16 | Authentication, authorization, and audit trail | Elish | Done | Added independently salted scrypt hashes and HS256 access tokens with a 15-minute lifetime, issuer/audience checks, database role/active checks on every protected request, permission/ownership enforcement, login rate limiting, and credential-safe audit records. Added public Shipper signup, case-insensitive unique usernames, password/confirmation validation, and administrator-created single-use 24-hour role invitations with hashed tokens, atomic redemption, and revocation. The Administration screen lists accounts and enables/disables access while preventing self-deactivation; new accounts cannot set their own role or wallet mapping. Fixed rejected requests continuing into handlers while their asynchronous audit response was pending. Migration 006 adds invitations. All 63 dashboard tests, the frontend production build, and all 15 backend tests against Compose PostgreSQL, the live AI engine, and the local chain pass; migration 006 is applied. Server-side WebSocket expiry and account/role rechecks prevent disabled accounts receiving party events; registration integration covers role escalation, duplicate usernames, replay, expiry, revocation, simultaneous redemption, account disable, and rate limits. See [decisions 21 and 31](docs/decisions.md), the [OpenAPI contract](docs/contracts/platform.openapi.yaml), and [auth configuration](backend/migrations/README.md). |
| 17 | Order intake and AI/ML integration | Elish | Done | Added authenticated order submission with strict field validation, per-shipper pending-order scoping, generated IDs, and continued order intake when Track 1 is unavailable. Optimization gathers pending orders plus active/available wagon and route master data, validates the full Track 1 response and exact order set, and persists each successful run, plan, assignment, and order lock atomically; planned orders are immutable. Added plan retrieval and JSON/CSV export with shipper ownership checks, clean empty results, a 60-second default upstream timeout, 502 malformed-response handling, 503 unavailable handling, and 409 conflict handling with no partial plan. Updated the OpenAPI contract. Node 22 Compose-network suite: all 12 tests pass against PostgreSQL, including invalid fields, stubbed Track 1 timeout/outage/malformed responses, order intake during outage, atomic persistence, ownership, exports, and database-enforced immutability. The same suite also passed an end-to-end order and optimization request through the unchanged Track 1 AI engine. Added ownership-scoped GET /orders with status filtering and pagination, plus authenticated fixed CP-SAT/ML demonstration and evaluation endpoints for all four roles. Two PostgreSQL integration suites pass, including role access, unavailable AI, and no business-record creation by lab requests. |
| 18 | Blockchain integration: contract lifecycle relay | Elish | Done | Added contract acceptance with terms hash and plan/party ownership checks, plus a durable idempotency ledger that binds request hashes to replayable responses and reconciles uncertain accept/booking/shipment/delivery/settlement calls from on-chain state and events. The API reads the deployed address/ABI, verifies chain ID, signs local calls with the matching unlocked Hardhat demo account, and requires address-matched operator/shipper/carrier key secrets in production. Added carrier booking, shipment status, delivery confirmation, disputes/resolution, accounting release, closure, contract listing, and live contract detail/history. Freight and deductions remain integer paise; SLA deadline and wagon count derive from the assigned immutable plan. Payment release and closure remain separate operator actions to preserve the dispute window. Migration 003 persists operation state; OpenAPI and signer setup docs are updated. Node 22 Compose-network suite: all 13 tests pass against PostgreSQL. The live Track 1 + Track 2 test accepted one plan once, replayed idempotently, booked, delivered using vector F, returned ₹150,000 penalty, ₹24,000 demurrage, and ₹2,326,000 net, disputed/resolved, released, closed, and verified the terms hash and state directly on-chain. |
| 19 | Real-time sync: event cache, push, and resilience | Elish | Done | Added migration 004 for the persisted chain/block cursor, idempotent delivery-event writes, and durable operation payloads with actor, attempt, and retry state. The backend polls Track 2 every 2 seconds under a PostgreSQL advisory lock, reconciles contract/payment caches from the ledger every 30 seconds, and pushes lifecycle events to authenticated shipper/carrier WebSocket clients only. Contract list/detail reads now use the cache during chain outages; nonparty Administrator/Auditor views omit terms, assignments, and financial values. Chain-unavailable writes return HTTP 202 and retry from the saved payload with exponential backoff capped at 30 seconds. The live integration test confirms a direct on-chain booking updates the cache and notifies both parties, outage reads continue, a queued shipment update retries exactly once, corrupted cache state is repaired from chain, nonparty sockets receive no event, commercial terms stay redacted, and 50 sequential contract-list requests meet the 500 ms p95 target. All 13 backend tests pass on Node 22 against Compose PostgreSQL and the live local chain; the production dependency audit reports zero vulnerabilities, the backend image builds, the OpenAPI YAML parses, and `git diff --check` passes. Implementation choices are recorded in [decision 23](docs/decisions.md). |
| 20 | Dashboard foundation and shared components | Elish | Done | Added the React/Vite app foundation, four-role session/auth guards, role-filtered routes/navigation, backend API client with timeout and 401/503 handling, health polling, loading/error/empty states, responsive shell, Yard Marks design tokens selected during Phase 21, reduced-motion GSAP route transitions, and labeled synthetic-data mode. Added local font assets, frontend setup docs, and dashboard tests. At completion all 24 dashboard tests passed; TypeScript/Vite production build succeeded; `npm audit` reported zero vulnerabilities. Compose config and dashboard image build passed; a disposable container served the app and imported Track 1 sample data successfully. Visual checks covered login and the authenticated shell. See [decision 24](docs/decisions.md), [PRODUCT.md](PRODUCT.md), and [dashboard setup](dashboard/README.md). |
| 21 | Overview screen | Elish | Done | Replaced the placeholder with the Yard Marks overview for all four roles: four KPI cards, a confirmed in-transit schematic and contract list, seven-day wagon-utilization chart, today's allocation count, a five-item bounded dispute/SLA signal board, contextual links, animated refresh/hover states, and 15-second background refresh. Added the missing role-guarded `/dashboard/summary` endpoint with UTC day boundaries and aggregate-only Administrator data; Carrier and Auditor views use only their permitted redacted contract list. Summary failures stay local to their panel. All 30 dashboard tests pass; backend suite reports 12 passed with its live-chain-only case skipped. Node/React builds and the Docker backend image build pass. PostgreSQL auth, role denial, pending-order counts, trend shape, migration and order integrations passed against the running Compose database. Browser visual review at desktop and 375px found no horizontal overflow; mobile KPIs stack vertically. See [decision 25](docs/decisions.md). |
| 22 | Run optimization screen | Elish | Done | Added the Yard Marks optimization workshop at `/allocations` for Shipper and Administrator: order entry, three normalized weight dials, single-flight run progress, empty/outage handling, saved plan results, assignments, readable unassigned reasons, ranked alternatives, KPI metrics, and cost/on-time what-if comparison. Acceptance captures a registered Carrier wallet and contract terms, derives wagon count from the immutable plan, uses an idempotency key, handles queued chain operations, and routes successful creation to a contract receipt. What-if runs reuse the immutable saved order/yard snapshot and save child plans in the same scenario group; database constraints prevent more than one active acceptance and contract across alternatives. All 55 dashboard tests pass; the frontend build passes. All 13 PostgreSQL/Compose backend tests pass with the live AI engine and local chain, including saved-snapshot reuse, acceptance locking, and the vector-F contract lifecycle. Migration 005 is applied. See [decision 26](docs/decisions.md). |
| 23 | Contracts screen | Elish | Done | Replaced the contracts placeholder with a searchable, state-filtered, cursor-paged ledger and full detail view: eight-state progression with a dispute branch, party terms and assignment snapshots, financial deductions for parties, and chronological event history. Administrator/Auditor details now include public lifecycle event metadata while omitting terms, assignments, and money. Added carrier booking/shipment/delivery, party dispute, administrator resolution/release/close actions with backend-matched role/state gates, idempotency, queued retry, local refresh after success, and conflict errors that leave displayed state unchanged. Ownership-safe 404 messaging avoids confirming inaccessible contracts. Seven focused tests cover 20-item filtering, chronological hashes/actors, party privacy, audit read-only history, action matrix, successful updates, conflict handling, and 404 behavior. All 42 dashboard tests pass; frontend build and backend TypeScript/Docker image builds pass. Backend contract integration tests were skipped in this run because `TEST_DATABASE_URL` and live-chain settings were not configured. Browser review at desktop and 375px confirms the ledger and detail render without page-width overflow. See [decision 27](docs/decisions.md). |
| 24 | Tracking and settlement screen | Elish | Done | Added a contract tracking panel with ordered shipment/delivery milestones, actual delivery or planned ETA versus the contractual SLA, and copy that distinguishes plan predictions from live position. Settlement now shows the API-recorded integer-paise amounts alongside event-derived delay blocks and billable holding hours, including freight cap, dispute hold, and pending calculation states. Administrator/Auditor payloads expose only public milestone metadata; private settlement event details remain party-only. The mock vector-F contract follows the canonical 12-wagon/₹5-per-wagon-hour terms. All 44 dashboard tests pass; the frontend production build succeeds; backend suite reports 9 passed and 4 DB/live-chain integration skips; detector found no findings. Desktop was reviewed in the browser; a new mobile browser review was blocked by browser URL policy, so mobile visual acceptance remains open. |
| 25 | Alerts, export, and UI polish | Elish | Done (software) | Party-only live alerts, plan/settlement CSV, role-aware signup/login, freight register, saved plans, action audit and Administrator account/wagon/route workflows are implemented. Yard Marks now includes live CP-SAT & ML and blockchain demonstration pages. Blockchain headers, timestamps, parent links and roots come from the node; replay and reduced-motion controls are explicit. Accessibility fixes cover contrast, keyboard-scrollable tables, ARIA semantics and settlement descriptions. Operational allocations use a saved current planning clock; synthetic teaching cases retain their fixed epoch. See [TDP audit](docs/tdp-completion-audit.md) and [demo guide](docs/frontend-demo.md). Automated browser review and final evidence are recorded below; the unfamiliar-person walkthrough remains an external Phase 27 item. Genesis-first bounded history with full UTC/IST block dates and animated parent links; interactive CP-SAT candidate and model-matched Logistic Regression sigmoid walkthroughs add playback/speed/reduced-motion controls. See [interactive visualizations](docs/interactive-visualizations.md). |

### Integration and validation

| Phase | Work | Owner | Status | Evidence / notes |
|---|---|---|---|---|
| 26 | End-to-end flow validation | All three | Done | Clean isolated Compose build passes both exact settlement cases: late penalty 150,000 / demurrage 24,000 / net 2,326,000 paise; on-time deductions 0 / net 2,500,000. All four failure drills pass, including an actual chain process stop/restart with persisted blocks/state, queued delivery applied exactly once, duplicate acceptance and payout protection. Checks include canonical terms hashes, ownership, saved-snapshot what-if, dispute hold/resolution, event replay repair, ledger/cache history and 50 contract reads below 500 ms p95. Pinned Anvil persists the local ledger; deployment reuses verified bytecode/operator and Solidity compiles with pinned local solc. See [commands/evidence](docs/integration-validation.md). |
| 27 | Acceptance testing and final validation | All three | In progress — external acceptance pending | Automated suites pass: 88 AI tests, 19 PostgreSQL/live-service backend tests, dashboard tests/build, 60 Hardhat contract tests and 60 tests on an independent local Anvil node. Browser evidence covers responsive layouts, accessibility, block creation/replay and keyboard order-to-contract navigation; final results are recorded in the [validation report](docs/integration-validation.md). All main services are healthy with a populated real API/chain demo. Remaining external evidence: execution on another machine, an unfamiliar-person walkthrough, and the other teammates' Phase 0 machine checks. These are not claimed as completed by automation on this workstation. |

## Current setup checklist

Complete one column per person. Use `✓` only after the command/test succeeds on that person's machine; note blockers in the last column.

| Check | Alim | Parth | Elish | Command / evidence |
|---|---|---|---|---|
| Python 3.12+ | ✓ (3.13.2) | Pending | Pending | `python --version` |
| Node.js 22 | ✓ (22.22.3) | Pending | Pending | `node --version` |
| npm 10+ | ✓ (11.8.0) | Pending | Pending | `npm --version` |
| Docker Compose v2 | ✓ (v5.6.0) | Pending | Pending | `docker compose version` |
| Docker sanity check | ✓ | Pending | Pending | `docker run --rm hello-world` |
| Git | ✓ (2.49.0) | Pending | Pending | `git --version` |
| Track-language hello world | ✓ (Python HTTP 200) | Pending | Pending | Tested inline; no temporary files left in the repo |
| PostgreSQL container + query | ✓ (PostgreSQL 16) | Pending | Pending | Temporary container; `SELECT 1` returned `1`; container removed |
| Clone and push a branch | Pending | Pending | Pending | Verify the branch is visible to the other two members |

## Team decisions

The eight Phase 1 choices, reasons, and team approvals are recorded in [docs/decisions.md](docs/decisions.md).
