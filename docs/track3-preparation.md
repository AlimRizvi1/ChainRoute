# Track 3 audit and phased delivery roadmap

**Audit date:** 2026-10-18 (Asia/Kolkata)

**Scope:** Platform Phases 15–25, based on `README.md`, `docs/Plan.md`, the frozen contracts, team decisions, and repository files.
**Authority:** The development plan, `docs/contracts/`, and `docs/decisions.md` are authoritative for platform behavior. This audit identifies integration questions; it does not revise those sources or begin any phase beyond work explicitly approved by the user.

## Current project shape

The repository is a working Docker Compose skeleton with three independently owned tracks. Track 1 is a Python 3.12/FastAPI/OR-Tools optimizer with Pydantic contracts, deterministic fixtures, a logistic regression prediction model, and its own append-only SQLite diagnostic run log. Track 2 is Solidity 0.8.28 on Hardhat/ethers v6, with the completed booking, transit, delivery, settlement, dispute, and history lifecycle. Track 3 is TypeScript on Node 22: Fastify 5.2.1 and `pg` 8.13.1 serve the API; React 18.3.1, Vite 6.1.0, and TypeScript 5.7.3 serve the dashboard. PostgreSQL 16 is a separate Compose service.

The permitted dependency direction is dashboard → backend → PostgreSQL, Track 1 by HTTP, and Track 2 by its blockchain client. The dashboard must not call either external track directly. Track 1 keeps its diagnostic database independently; Track 3's PostgreSQL becomes authoritative for platform orders, master data, runs/plans, platform audit records, and its read cache of ledger state. On any contract cache mismatch, the on-chain ledger wins.

The only dashboard implementation present is the Phase 2 responsive service-status view in `dashboard/src/status.tsx` and `dashboard/src/style.css`. The backend's `backend/src/server.ts` contains open `/health` and `/blockchain/contract` reads, PostgreSQL connectivity checking, and no Phase 15–19 business API. Three npm manifests and lockfiles exist. At the beginning of the phase, all three lockfile roots matched their manifests; no per-track `node_modules` folders were present. No repository `AGENTS.md` file exists. The working tree was clean before this request.

The Plan cites an SRS v1.0 and Technical Design v1.0 as source material, but those originals are not checked in. The frozen Plan, contracts, and approved decision log are the actionable requirements available in this clone.

`docker-compose.yml` runs the optimizer, Hardhat node and deployer, PostgreSQL, backend, and the service-status dashboard. Its current database is a persistent volume. The existing backend Docker build context is `backend`, while the accepted Track 1 generator fixtures live in the repository-root `samples/` directory. A Phase 15 build must intentionally make the approved fixture available to the backend image while preserving independent service deployment.

## Baseline checks and boundaries

- Parsed the six JSON contracts and four JSON examples in their files; JSON syntax is valid.
- Validated `samples/optimize-request.json`, `samples/allocation-plan.json`, and `samples/contract-terms.json` against their relevant draft-2020-12 contract definitions. Validated each 25-order fixture by adding the required test weights. The fixture checks passed.
- Resolved all 152 local `$ref` pointers in `docs/contracts/platform.openapi.yaml`; it declares 22 paths and 26 operations. This checks reference integrity, not full OpenAPI semantic validity.
- Read the role matrix in Plan Appendix A, the Track 1 request/response schema and optimizer code, the Track 2 Solidity contract and tests, the deployment/bridge scripts, the platform OpenAPI operations and data shapes, and all of the phase-specific criteria recorded below.
- Current host reports Node 24.9.0 and npm 11.6.0; the project specifies Node 22. Docker Compose is installed, but Windows denied access when starting the Docker Desktop service. Phase 15 database tests were later verified on a temporary loopback-only PostgreSQL 18 cluster because the existing server on port 5432 rejects the repository's documented default credentials. Docker image build remains unverified until Docker Desktop is available.
- The installation step triggered `npm ci --ignore-scripts` in `backend/`, using the existing lockfile; npm reported one high-severity advisory. No dependency version was added or changed as part of skills setup. Review the advisory before a later security-sensitive dependency update; do not bulk-upgrade a frozen lockfile during Phase 15 without evidence and approval.
- Phase 15 consumes the current user instruction to begin the first remaining Track 3 phase. Phase 16 and later remain separate approval gates. Phases 26–27 remain explicitly gated on separate user approval.

## Phase 15–25 roadmap

Each row identifies the plan's exact phase boundary. Phase 15 first installs the schema, guarded migrations, source fixture seed, and database verification. Phases 16–19 build server-side security, intake/AI, chain relay, cache/push, and recovery in order. Phases 20–25 establish the dashboard shell, then build one connected operational workflow screen at a time. The application README's Track 3 table is updated only with work actually implemented and verified.

| Phase | Deliverable and evidence before its gate |
|---|---|
| 15 — Persistence and migrations | PostgreSQL schema and migration ledger, retry-safe clean seed, relationships and constraints, restart persistence, schema documentation, and repeatable migration/seed tests. Update only Track 3 row 15. Stop and request approval for Phase 16. |
| 16 — Authentication and authorization | Hashed credentials, signed token, centralized exhaustive role/ownership checks, invalid/deactivated-user rejection, and exactly one safe append-only audit record per write. Test every RBAC matrix pair. Record credential/hash/lifetime and signing-identity choices. Stop for approval for Phase 17. |
| 17 — Order intake and AI integration | Typed validation and persisted orders; immutable locked inputs once planned; independently retrievable plan/run; stub and real Track 1 contract tests; export; timeout, malformed-response and unavailable-optimizer handling. Record pending/rejection policy and timeout. Stop for approval for Phase 18. |
| 18 — Contract lifecycle relay | Load the deployer-created ABI/address artifact; canonical full-terms hash; safely signed, role-correct idempotent calls; accepted-plan agreement and delivery flow; explicit reconciliation for a crash between transaction and cache write. Test mock then actual contract. Stop for approval for Phase 19. |
| 19 — Sync, cache, push and resilience | Rebuildable ledger-derived event cache, guarded one-time queued writes, schedule and reconcile rules, role-filtered WebSocket events and reads, and cross-party isolation. Test cache rebuild, node outage, reconnection and the response meaning of queued writes. Stop for approval for Phase 20. |
| 20 — Dashboard foundation | Route shell, login/session behavior, typed API/error handling, stable mock/real switch, service-health banner, correct four-role route/action filtering, and reusable skeleton/empty/error components. Resolve session storage and navigation treatment. Stop for approval for Phase 21. |
| 21 — Overview | Summary-driven operational opening screen, role-correct actions, alert feed, real shipment visibility or documented fallback, meaningful chart, independent error/empty/sample states, keyboard order and mobile layout. Stop for approval for Phase 22. |
| 22 — Run optimization | Complete order-submit → optimize → compare/what-if → accept sequence, normalized weights, accessible result and reason presentation, double-submit protection, and cross-service error handling. Test distinct dataset outcomes. Stop for approval for Phase 23. |
| 23 — Contracts | Filterable searchable list, detailed terms/history, accurate all-state timeline including disputes, role/state action combinations from Appendix A, and API/chain event parity. Stop for approval for Phase 24. |
| 24 — Tracking and settlement | Shipment milestones and ETA/SLA view, carrier state-guarded action forms, truthful queued/disputed/settled states, and exact backend-provided paise deduction/net display. Test vector F and zero-value cases. Stop for approval for Phase 25. |
| 25 — Alerts, export and polish | Private live alerts, CSV exports matching displayed records, accessible and responsive completion across all screens, keyboard walkthrough, motion reduction, and introductory operator usability evidence. Stop; prepare a Track 3 readiness report. Phases 26–27 start only after explicit approval. |

## Exact acceptance criteria from `docs/Plan.md`

The checklists below reproduce the plan's acceptance criteria for Phases 15–25. They are the pass/fail gate even when design polish or a demo appears complete. Parenthesized phase labels are descriptive only; they do not check any criteria.

### Phase 15 — Backend Foundation: Persistence and Migrations

- [ ] Any member can wipe and rebuild their local database with one command.
- [ ] The schema is documented alongside the migrations (table purposes and key relationships).

### Phase 16 — Authentication, Authorization and Audit Trail

- [ ] The RBAC matrix is verified by one data-driven test covering every cell of Appendix A.
- [ ] No password, in any form, appears in logs or responses.
- [ ] Every state-changing endpoint produces exactly one audit row per call.

### Phase 17 — Order Intake and AI/ML Integration

- [ ] Every test case passes against the stub, then again against the real Track 1 service, unchanged.
- [ ] Stopping the Track 1 container demonstrably leaves order submission working.

### Phase 18 — Blockchain Integration: Contract Lifecycle Relay

- [ ] The full vector-F sequence (accept → book → deliver late → see the breakdown) works through HTTP calls alone, first against the Phase 2 stub, then against the real Track 2 contract.
- [ ] No accept-plan or delivery-confirmation call can create two agreements or apply settlement twice, even under retries.

### Phase 19 — Real-Time Sync: Event Cache, Push and Resilience

- [ ] Stopping and restarting the chain node mid-session loses no state-changing action.
- [ ] Cross-shipper and cross-carrier visibility isolation is proven by automated tests.
- [ ] Track 3's backend is now feature-complete as an API: every endpoint from §8 exists and behaves per its tests.

### Phase 20 — Dashboard Foundation and Shared Components

- [ ] All four roles log in and see exactly the screens they are entitled to.
- [ ] Loading, empty, and error states exist as reusable components, used consistently.

### Phase 21 — Overview Screen

- [ ] Loading, populated, empty, and error states all look intentional, not accidental.
- [ ] Keyboard navigation order is sensible, and focus is visibly indicated throughout.

### Phase 22 — Run Optimization Screen

- [ ] The full flow — submit an order, run, what-if, accept — works end to end against the real backend and Track 1.
- [ ] Two clearly different weightings produce visibly different results on the demo dataset.

### Phase 23 — Contracts Screen

- [ ] Every action button appears only for the exact (role, state) combinations the backend would accept — verified against Appendix A.
- [ ] The log shown on screen matches the chain's own log for the same contract, field for field.

### Phase 24 — Tracking and Settlement Screen

- [ ] The vector-F breakdown renders exactly as specified above.
- [ ] Colour is never the only signal distinguishing on-time from late, or settled from disputed.

### Phase 25 — Alerts, Export and UI Polish

- [ ] A person who has not seen the application before can complete an order-to-plan flow after only a short walkthrough, satisfying the SRS Usability NFR.
- [ ] Track 3 is considered feature-complete across both the backend API and the dashboard.

## Risks and contract conflicts to resolve before the dependent phase

These points are surfaced now so a phase does not quietly change a frozen contract. Resolution belongs in the phase-specific review, with an approved cross-track decision and contract edit where necessary.

| Ref | Evidence and constraint | Phase to resolve |
|---|---|---|
| C1 — Auditor terms access | The plan says commercial terms are not exposed to a non-party, yet Appendix A and the frozen platform OpenAPI grant Auditor list/detail access to all contracts, and detail includes the full `terms` object. Read-only history may be acceptable while term secrecy is not; the current boundary is inconsistent. | 16/19, before exposing cached details. Decide field-level redaction versus a clarified privacy rule with all affected reviewers. |
| C2 — Disputes by Administrator | Appendix A/OpenAPI allow an Administrator to raise a dispute. Track 2 only accepts either named contract party; there is no operator dispute function. Backend signing cannot truthfully make an administrator a party. | 18, before the Administrator dispute action can be relayed. Revise the API/RBAC surface or contract permission with team approval. |
| C3 — Write queue versus immediate failure | Phase 18 requires a stopped-chain accept to return 503 without a half-created cache record; Phase 19 requires state-changing calls to queue, and the OpenAPI says a 503 dependency error is queued for retry. A response that fails the request yet later commits can surprise a client unless its queue ID/status is explicit and keyed idempotently. | 18–19. Define synchronous accept versus durable queue semantics, acknowledged response, polling/read state and retry behavior. |
| C4 — Detail fields for settlement and proof | `GET /contracts/{id}` declares terms, hashes, assignment, deduction amounts, net, and state-history hashes. It does not expose delivery proof/timestamp, penalty block count/rate, demurrage hours/rate/cap, payout transaction reference, or the transaction/block identity required to compare each history row to the chain. | 18, 23–24. Add fields/endpoints and version the frozen API before the UI promises those fields. |
| C5 — Dashboard summary gap | The frozen summary has pending orders, active and delivered contracts, and total freight value; Phase 21 additionally calls for utilization, pending payments, today's activity, and a trend. No agreed access/aggregate endpoint returns these. Dashboard summary is forbidden to Carrier and Auditor. | 19/21. Agree on role-safe fields and a source of truth. Do not synthesize missing KPI figures or imply Auditor is authorized for the Shipper/Admin summary. |
| C6 — Geography and location gap | The route fixture supplies directed origin/destination names, distance, and transit duration only. Orders have destinations; shipments have no GPS or coordinate stream. Plan requires a map and a tile-source decision but does not name either. | 21, prior to selecting a map provider. Add trustworthy coordinate data or approve a route diagram and list fallback. |
| C7 — Alerts and settlement export surfaces | Phase 25 requires real-time SLA/delay/dispute alerts, push, and CSV settlement export, but frozen OpenAPI has no alert subscription, WebSocket message schema, or settlement export operation. It also has no explicit platform release/close operation despite Plan §8 naming contract actions. | 18–19/25. Freeze endpoints/events/action ownership and settlement trigger behavior before UI. |
| C8 — Order IDs and pending/run association | `POST /orders` creates a platform-owned ID, while Track 1 requires each order's ID in its optimizer request. The current API defines no pending-order read endpoint, and Track 1 returns generated plan/run IDs. Platform must own stable unique input IDs and atomically bind each input to the generated run/plan to enforce its lock. | 15/17. Model owner and run/order/plan relations in Phase 15; detail request scoping/idempotency in Phase 17. |
| C9 — Identity signing | The chain only allows the configured operator to create/release/close; carriers sign booking, shipment, and delivery calls; parties dispute; arbitrator resolves. The OpenAPI's `chainAddress` is only an address mapping and does not specify key custody. A browser-held key would violate the trust boundary. | 16/18. Decide backend key custody and demo network mode before chain writes; keep private keys out of the browser and logs. |
| C10 — Multiple package runtime drift | Dockerfiles use Node 22, matching the plan; the current host is Node 24. Lockfiles are pinned and coherent. An npm audit during the authorized backend dependency install reports one high advisory. | 15/16. Verify supported runtime in Docker; document, inspect and resolve dependency advisory through the normal security decision process before production reliance. |

## Preparation deliverables

- `skills/skills.md` records seven verified, pinned design/performance/security skills and the optional tools/packages deliberately deferred.
- `frontend/frontend_design.md` defines the proposed visual system, navigation, reusable components, screen direction, meaningful transitions, accessibility, responsive behavior, performance, and review checklist.
- `docs/track3-preparation.md` records the verified repository architecture, phase roadmap, exact acceptance checklists, contract risks, and known environment limits.
- The shared project progress tracker is `README.md`. Preparation documents do not mark a phase complete; after the user requested work begin, the Phase 15 row was updated as implementation and verification evidence became available, and set to `Done` only after the schema, seed, migration integration suite, and guarded one-command reset all passed.
