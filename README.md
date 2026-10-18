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

### Run the local walking skeleton

Docker Desktop with Compose v2 is required. The defaults are for local development only. Copy the example environment file if you want to customize ports or the PostgreSQL password:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

When the services report healthy, open the dashboard at <http://localhost:5173>. The backend health endpoint is <http://localhost:8080/health>; Track 1 is at <http://localhost:8000/health>, and the local JSON-RPC node is at <http://localhost:8545>.

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

## Project layout

```text
ai-engine/          Track 1 — Python allocation service, data generator and validators
blockchain/         Track 2 — Solidity contracts and deployment
backend/            Track 3 — TypeScript API
dashboard/          Track 3 — TypeScript web UI
samples/            Phase 1 API examples and Phase 3 synthetic datasets
docs/
  contracts/        Cross-track schemas and synthetic-data rules
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
| 7 | Machine-learning prediction component | Alim | Done | All 69 AI-engine tests pass. Deterministic logistic regression uses 30,000 synthetic lognormal transit outcomes and a stratified 80/20 split (seed 42); held-out probability MAE is 0.0098 (≤ 0.10 tolerance). Boundary, monotonicity, determinism, unseen-cargo and missing-model fallback, ranking integration, and 300-order prediction performance are covered; 300 predictions measured 0.0010 s. Model version is content-derived; see [prediction contract](docs/contracts/ai-engine.md), [training command](ai-engine/train_prediction_model.py), and [decision log](docs/decisions.md). |
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
| 15 | Backend foundation: persistence and migrations | Elish | Done | Added the PostgreSQL schema and checksum-locked migration runner; startup applies migrations and safely seeds four role demo users plus Track 1 wagons/routes. `npm run db:reset` rebuilds only the dedicated local `chainroute` database and refuses production or a different target. Added schema/relationship documentation and an isolated integration suite. `cd backend; npm test` against a temporary loopback PostgreSQL cluster: build and all 5 tests pass, covering migration ordering/idempotency, constraints, foreign keys, repeatable seeding, and preserving edited master data. Verified `npm run db:reset` end to end: 1 migration, 4 users, 119 wagons, 4 routes. `docker compose config --quiet` and `git diff --check` pass. Docker image build remains unverified because Docker Desktop service is stopped. `npm ci --ignore-scripts` reported one high-severity advisory in the existing backend dependency tree; package versions were not changed. Proposed persistence decisions are recorded in [decision 20](docs/decisions.md) for team review. |
| 16 | Authentication, authorization, and audit trail | Elish | Not started | |
| 17 | Order intake and AI/ML integration | Elish | Not started | |
| 18 | Blockchain integration: contract lifecycle relay | Elish | Not started | |
| 19 | Real-time sync: event cache, push, and resilience | Elish | Not started | |
| 20 | Dashboard foundation and shared components | Elish | Not started | |
| 21 | Overview screen | Elish | Not started | |
| 22 | Run optimization screen | Elish | Not started | |
| 23 | Contracts screen | Elish | Not started | |
| 24 | Tracking and settlement screen | Elish | Not started | |
| 25 | Alerts, export, and UI polish | Elish | Not started | |

### Integration and validation

| Phase | Work | Owner | Status | Evidence / notes |
|---|---|---|---|---|
| 26 | End-to-end flow validation | All three | Not started | |
| 27 | Acceptance testing and final validation | All three | Not started | |

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
