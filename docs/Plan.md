# ChainRoute — Technical Development Plan (3-Member Team)

A staged, CodeCrafters-style build plan for the ChainRoute prototype, restructured for a team of **three members** instead of four. Every phase states what to build, why it is needed, and how to verify it works — never how to write it. Implementation is left entirely to the builder.

Source documents: *ChainRoute SRS v1.0* and *ChainRoute Technical Design v1.0*. Requirement IDs (`FR-A1` …), function names (`createAgreement()` …) and non-functional requirements are taken from those documents. Where this plan restructures the original four-module design into three, that restructuring is marked explicitly as a **Decision**, not treated as given.

---

## Contents

1. [Team and Module Restructuring](#1-team-and-module-restructuring)
2. [Project Architecture](#2-project-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Setup Instructions](#4-setup-instructions)
5. [Dependencies](#5-dependencies)
6. [Folder Structure](#6-folder-structure)
7. [Integration Strategy](#7-integration-strategy)
8. [Shared Conventions and Interface Contracts](#8-shared-conventions-and-interface-contracts)
9. [Performance Requirements](#9-performance-requirements)
10. [Error Handling Strategy](#10-error-handling-strategy)
11. [How to Read a Phase](#11-how-to-read-a-phase)
12. [Phase Map](#12-phase-map)
13. [Development Phases](#13-development-phases)
    - [Foundation](#foundation-phases-0-2): 0–2
    - [Track 1 — AI/ML Allocation Engine](#track-1--aiml-allocation-engine-python): 3–8
    - [Track 2 — Blockchain Settlement Layer](#track-2--blockchain-settlement-layer-solidity): 9–14
    - [Track 3 — Platform (Backend API + Dashboard)](#track-3--platform-backend-api--dashboard): 15–25
    - [Integration](#integration-phases-26-27): 26–27
14. [Final Validation](#14-final-validation)
15. [Appendices](#15-appendices)

---

## 1. Team and Module Restructuring

The Technical Design splits the system into four modules across three members, with one member covering both the backend orchestrator and the dashboard (Technical Design §2.1, §11). This plan keeps that **three-person** split but names the three workstreams directly, so each person owns exactly one track end to end:

| Track | Owns | Replaces (original module numbering) |
|---|---|---|
| **Track 1 — AI/ML Allocation Engine** | The optimization/allocation logic: an agent-style allocation algorithm plus a machine-learning prediction component | Module 1 (AI/ML Optimization Engine) |
| **Track 2 — Blockchain Settlement Layer** | The smart contract, its lifecycle, and its deployment | Module 2 (Blockchain Settlement Layer) |
| **Track 3 — Platform (Backend API + Dashboard)** | The orchestrator API *and* the web dashboard, as one person's responsibility | Module 3a (Orchestrator) + Module 3b (Dashboard) |

**Decision — "AI" and "ML" as two components of one track.** The SRS asks for "AI/ML optimization" without separating an agent-style decision algorithm from a learned/statistical component (SRS §1.1; Technical Design §3.4 lists CP-SAT, a Genetic Algorithm, or a hybrid as *suggested* techniques, not a mandate). This plan treats Track 1 as having two deliverables, built in sequence:

1. **An allocation agent** — a decision-making algorithm that searches for and selects a wagon/route assignment for a set of orders under constraints (capacity, route connectivity, deadlines). This is the direct implementation of FR-A3/FR-A4.
2. **A learning component** — a model trained on logged data (synthetic or historical) that predicts something the agent cannot compute directly from static rules, most usefully delivery-time variability feeding FR-A5's on-time-probability figure. It should also be presentable as an improvement over a naive estimate.

Nothing downstream (the Platform's `optimize` contract, or the dashboard's display of metrics) depends on which specific agent technique or learning model you choose, provided the output in Phase 3's frozen contract is satisfied. Pick a specific technique for each in Phase 1 and record it as a decision — this plan deliberately avoids choosing one for you.

**Why this split works for three people (adapted from Technical Design §2.3):** each track has one clear external contract (what Track 1 returns, what Track 2's contract exposes, what Track 3 serves to the browser), so two tracks can be stubbed and built against before the third is finished. Track 3 is the only track with internal sequencing of its own (API before UI), which is reflected in its longer phase list below.

---

## 2. Project Architecture

```
                         ┌─────────────────────────┐
                         │   Track 3 — Platform     │
   Shipper/Carrier/      │  ┌─────────┐ ┌─────────┐ │
   Admin/Auditor  ──────▶│  │ Backend │◀│Dashboard│ │
   (browser)             │  │   API   │ │   (UI)  │ │
                         │  └────┬────┘ └─────────┘ │
                         └───────┼─────────┬─────────┘
                                 │         │
                     optimize() │         │ createAgreement() /
                     (HTTP)     │         │ confirmBooking() / ...
                                 ▼         ▼ (chain client)
                   ┌───────────────────┐ ┌───────────────────┐
                   │ Track 1 — AI/ML    │ │ Track 2 —          │
                   │ Allocation Engine  │ │ Blockchain          │
                   │ (agent + ML model) │ │ Settlement Layer    │
                   └───────────────────┘ └───────────────────┘
```

**Rules that follow from this diagram, and must hold throughout the build:**

- The dashboard never calls Track 1 or Track 2 directly. It only calls the backend API. (SRS FR-D1/FR-D2 are enforced once, at the backend.)
- Track 1 and Track 2 never call each other or the backend; they only respond to requests.
- Track 1 has no shared operational-database dependency: it receives orders/wagons/routes/weights and returns a plan. It owns a local SQLite diagnostic run trace (including the request snapshot); the Platform remains authoritative for operational orders, master data, and accepted plans, and may persist its own linked run metadata.
- Track 2 is the **source of truth** for contract state. The Platform may cache it for speed, but on any disagreement the ledger wins (Technical Design §8.1).
- Each track must remain independently deployable and independently testable (SRS Scalability NFR): Track 1 as a standalone service, Track 2 as a standalone chain + contract, Track 3 as backend + dashboard.

---

## 3. Technology Stack

Recommended defaults. Nothing downstream depends on the specific language, only on the contracts frozen in Phase 1 — a track can use a different stack if the contract is still met.

| Track | Language | Recommended tools | Test tooling |
|---|---|---|---|
| Track 1 — AI/ML Allocation Engine | **Python 3.12** | FastAPI, Pydantic v2; an agent/search library or hand-built search (e.g. OR-Tools CP-SAT) for the allocation agent; a standard ML library (e.g. scikit-learn) for the learning component | pytest |
| Track 2 — Blockchain Settlement Layer | **Solidity 0.8.x** | Hardhat, ethers v6; optionally OpenZeppelin `AccessControl` | Hardhat + Chai |
| Track 2 scripts & tests | **JavaScript / TypeScript (Node 22)** | Hardhat scripts, deploy tooling | Hardhat test runner |
| Track 3 — Backend API | **TypeScript (Node 22)**, recommended for a single owner of both API and UI | Fastify or Express, Zod for validation, Prisma or Knex for data access with migrations, `jsonwebtoken` for auth, `ws` for WebSocket push, `ethers` for the chain client | Vitest or Jest, supertest |
| Track 3 — Dashboard | **TypeScript** | React, Vite, React Router, TanStack Query, Recharts, Leaflet | Vitest, Testing Library, Playwright |
| Database | SQL | PostgreSQL 16 | exercised via the backend's tests |
| Local blockchain | — | Hardhat node for development (Technical Design §4.3 names Ganache, which is now deprecated; the contract interface is unaffected). Sepolia optional for a live demo | — |
| Packaging | — | Docker, Docker Compose v2 | — |

**Decision — one language for Track 3.** The Technical Design suggests Kotlin for the orchestrator and TypeScript for the dashboard (two languages, two people). With one person covering both, this plan recommends **TypeScript end to end** for Track 3, so the same types, the same error-handling idioms, and the same tooling apply to both halves. If you prefer to keep Kotlin for the backend, every Track 3 phase, test and acceptance criterion in this plan still applies unchanged — only the implementation language changes.

**Why these languages otherwise:** Python has the richest ecosystem for both search/optimization and ML work, so Track 1 does not need two languages. Solidity is what the target chains run. TypeScript covers both halves of Track 3 with one toolchain and one type system.

> If you prefer a permissioned chain (Hyperledger Fabric, Technical Design §4.3), Track 2's language changes (chaincode in Go or Node) but every phase, test and number in this plan stays the same.

---

## 4. Setup Instructions

### 4.1 Prerequisites (install once, verify on every machine)

| Tool | Version | Verify with |
|---|---|---|
| Python | 3.12+ | `python3 --version` |
| Node.js / npm | 22 / 10+ | `node --version` |
| Docker Desktop with Compose v2 | recent | `docker compose version` |
| PostgreSQL client (optional; Docker provides the server) | 16 | `psql --version` |
| Git | any recent | `git --version` |

### 4.2 Order of setup

1. Every member installs and version-checks every tool above (not just the one for their own track — anyone should be able to run the whole system).
2. Create one shared Git repository with the folder layout in §6.
3. Each member creates a minimal "hello world" in their track's language, run outside Docker, to confirm the toolchain works on their machine (this is Phase 0 below).
4. As a team, freeze the interface contracts and write sample payloads (Phase 1 below) before any track-specific logic is written.
5. Build the walking skeleton (Phase 2): the smallest version of all three tracks, wired together with Docker Compose, started with one command.

### 4.3 Suggested ports and environment variables

| Service | Port |
|---|---|
| AI/ML Allocation Engine | 8000 |
| Backend API | 8080 |
| Dashboard (dev server) | 5173 |
| Local blockchain node | 8545 |
| PostgreSQL | 5432 |

| Variable | Used by | Purpose |
|---|---|---|
| `AI_ENGINE_URL` | Backend | Where to reach Track 1 |
| `CHAIN_RPC_URL` | Backend, Track 2 deploy scripts | Where to reach the chain node |
| `DATABASE_URL` | Backend | PostgreSQL connection string |
| `JWT_SECRET` | Backend | Token signing key |
| `CONTRACT_ADDRESS`, `CONTRACT_ABI_PATH` | Backend | Where to find the deployed contract |
| `VITE_API_TARGET` | Dashboard dev server | Where to proxy API calls |

Every environment variable must have a safe local default so the system runs from a fresh clone with zero manual configuration (SRS implied Reliability expectation; Technical Design §10.3).

---

## 5. Dependencies

### 5.1 Dependency direction (must never be violated)

```
Dashboard  ──depends on──▶  Backend API
Backend API ──depends on──▶ AI/ML Allocation Engine (HTTP)
Backend API ──depends on──▶ Blockchain Settlement Layer (chain client)
Backend API ──depends on──▶ PostgreSQL
```

No other arrows are permitted. In particular: the AI/ML engine never depends on the blockchain layer or the database; the blockchain layer never depends on the AI/ML engine; the dashboard never depends on anything except the backend API.

### 5.2 Build-order dependency (what blocks what)

| This phase… | …needs this phase done first |
|---|---|
| Phase 2 (walking skeleton) | Phase 1 (contracts frozen) |
| Any Track 1 phase after 3 | The previous Track 1 phase |
| Any Track 2 phase after 9 | The previous Track 2 phase |
| Phase 17 (order intake + AI/ML integration) | Phase 4 (or its stub from Phase 2) |
| Phase 18 (blockchain integration) | Phase 10 (or its stub from Phase 2) |
| Phase 19 (full settlement relay) | Phases 12–13 |
| Phases 21–24 (dashboard screens with live data) | Phases 17–19 (mock data is sufficient until then) |
| Phase 26 (end-to-end flow) | Every phase above |

Outside of these, **Tracks 1, 2 and 3 are independent** after Phase 2 and should be built in parallel, each against the stubs and sample data from Phases 1–2.

---

## 6. Folder Structure

One folder per track, a shared `samples` folder for hand-made example payloads, and a shared `docs` folder for the frozen contracts and the decision log.

```
chainroute/
├── ai-engine/            Track 1   Python
├── blockchain/           Track 2   Solidity
├── backend/               Track 3a  TypeScript (API)
├── dashboard/             Track 3b  TypeScript (UI)
├── samples/               Hand-made example payloads (Phase 1)
├── docs/
│   ├── contracts/         The interface between tracks (Phase 1)
│   └── decisions.md        Decision log — one entry per decision in this plan
├── docker-compose.yml     (Phase 2)
└── README.md
```

`backend/` and `dashboard/` are two folders because they are two deployable services (API and static/dev-served UI) even though one person owns both.

---

## 7. Integration Strategy

1. **Contract-first.** Phase 1 produces a written, versioned description of every call between tracks, plus hand-made sample payloads. No track's internal logic is written before this exists.
2. **Stub before real.** Phase 2 gives every track a trivial stand-in for the other two (a canned response from Track 1, a placeholder contract from Track 2, a health check from Track 3). Each track builds and tests against these stubs, then swaps to the real dependency without changing its own interface.
3. **One integration point at a time.** Track 3 integrates Track 1 first (Phase 17), proves it works end to end for the order → plan path, then integrates Track 2 separately (Phases 18–19). This isolates failures to one boundary at a time instead of debugging two new integrations simultaneously.
4. **The ledger is the source of truth.** Any cached copy of contract state in the Platform's database must be reconciled against the chain, never the reverse (Technical Design §8.1).
5. **Idempotency at every state-changing boundary.** Any call that changes contract state (accept plan, confirm delivery) must be safe to retry without double effect, because Track 3 must retry rather than drop actions when Track 1 or Track 2 is briefly unreachable (Technical Design §10.2, §5.2).
6. **Final integration is scripted, not manual.** Phase 26 automates the full order-to-settlement sequence so that integration is verified by a repeatable run, not a one-off demo rehearsal.

---

## 8. Shared Conventions and Interface Contracts

These are **proposed defaults**. Confirm or change them as a team in **Phase 1**; after that they are frozen, and every test in this plan assumes them.

| Topic | Proposed rule |
|---|---|
| Timestamps | ISO-8601 UTC strings over HTTP (`2026-01-08T06:00:00Z`); unix seconds on-chain; the backend converts between the two. |
| Priority | Integer `1` (highest) to `3` (lowest). |
| Quantity / capacity | Tonnes. |
| Money | Integers in the smallest currency unit. Never floating-point. *(This plan's worked examples use plain integers for readability.)* |
| Contract state | Fixed enum order (Technical Design §8.2): `0 Created, 1 Booked, 2 InTransit, 3 Delivered, 4 PenaltyCalculated, 5 PaymentReleased, 6 Closed, 7 Disputed`. |
| IDs | Strings over HTTP (`ORD-0001`, `plan-…`, `run-…`); `uint256` on-chain, sent as strings in JSON. |
| HTTP error body | `{"error": {"code": "STRING_CODE", "message": "human text", "fields": {"field": "why"}}}` — `fields` optional. |
| HTTP status codes | `400` bad input · `401` no/invalid token · `403` wrong role · `404` not found **or not yours** (never confirm existence to an unauthorized caller) · `409` wrong state for the requested action · `503` a dependency (AI engine or chain) is unreachable. |
| Backend endpoints | As named in Technical Design §7.3: `POST /orders`, `POST /optimizations/run`, `POST /plans/{id}/accept`, `GET /contracts`, `GET /contracts/{id}`, `POST /contracts/{id}/confirm-delivery`, `POST /contracts/{id}/dispute`, `GET /dashboard/summary`. |
| AI/ML engine endpoint | Technical Design §7.1 defines `optimize(orders, wagons, routes, weights) → AllocationPlan`. This plan writes it as `POST /v1/optimize`; use whatever you freeze in Phase 1. |

### 8.1 The `AllocationPlan` contract (Track 1 → Track 3)

Frozen in Phase 1, built in Phases 3–8. Minimum shape:

- Request: `orders[]` (cargo type, quantity, destination, priority, deadline), `wagons[]` (capacity, type, location, availability), `routes[]` (origin, destination, distance, transit time), `weights` (on-time, cost, utilization — finite nonnegative values, normalized by the engine), and optional `timeBudgetSeconds` (0.05–10; default 1).
- Response: `planId`, `runId`, `assignments[]` (order → wagons → route → depart/ETA), `metrics` (utilization %, cost, distance, on-time probability), `unassignedOrders[]` with reason codes, `alternatives[]` (ranked runners-up).

### 8.2 The contract lifecycle interface (Track 2 → Track 3)

Frozen in Phase 1, built in Phases 9–14. Functions: `createAgreement`, `confirmBooking`, `updateShipmentStatus`, `confirmDelivery`, `evaluateSLA`, `calculatePenalty`, `calculateDemurrage`, `releasePayment`, `raiseDispute`, `resolveDispute`, `getContractStatus`, `closeContract` (Technical Design §4.2). Events mirror each state-changing function.

### 8.3 The reference example

Every later phase that touches money reuses this one contract, so numbers can be cross-checked across every layer:

| Term | Value |
|---|---|
| Freight value | 2,500,000 |
| SLA deadline | 2026-01-08T06:00:00Z |
| Penalty | 2% of freight value (200 basis points) per *started* 6-hour block late |
| Free holding time | 6 hours |
| Demurrage | 500 per wagon per hour beyond free time |
| Wagons | 12 |

---

## 9. Performance Requirements

Taken directly from the SRS Non-Functional Requirements table:

| Requirement | Target | Verified in |
|---|---|---|
| Optimization run time | A run over the demo dataset (up to a few hundred orders) completes in a few seconds to low tens of seconds | Phase 8 |
| Dashboard load time | Key summary data loads within 2 seconds under normal demo conditions | Phase 21, Phase 25 |
| Degraded-service behaviour | If Track 1 or Track 2 is temporarily unavailable, the dashboard shows a clear degraded-service message rather than failing silently | Phase 2, Phase 17, Phase 20 |
| Independent scalability | Track 1 and Track 2 can be redeployed or scaled independently of Track 3 | Phase 2 and the architecture rules in §2 |
| Usability | A non-technical user completes order submission and delivery confirmation without training beyond a short walkthrough | Phase 25, Phase 27 |

Set a numeric target for anything the SRS leaves open (for example, the backend's own response-time budget, or how many concurrent users to test with) as a team decision in Phase 1, and record it in the decisions log.

---

## 10. Error Handling Strategy

| Failure | Required behaviour |
|---|---|
| Bad input to any HTTP endpoint | `400` with a field-level reason; the request must never reach Track 1 or Track 2 |
| No or invalid auth token | `401`; no information about the requested resource is leaked |
| Caller lacks the role or ownership for the action | `403` for a role problem; `404` for an ownership problem (never confirm that a resource exists to someone not entitled to see it) |
| Action requested in the wrong contract state | `409`, naming the current and the required state |
| Track 1 (AI/ML engine) unreachable or times out | Backend returns `503` naming the dependency; order intake and all read operations continue to work (SRS Reliability NFR) |
| Track 2 (blockchain node) unreachable | Backend returns `503` for new state-changing calls, but **queues** them and retries rather than dropping them; reads continue to be served from cache (Technical Design §10.2) |
| A state-changing call is retried after a timeout | The effect is applied once; the second attempt returns the same result, not a duplicate side effect (idempotency, Technical Design §5.2) |
| The contract itself rejects a call (invalid terms, wrong caller, wrong state) | The chain's specific, named error is mapped to a specific HTTP status, never a generic `500` |
| Any unexpected server-side failure | Logged with enough context to reproduce it; the caller receives a generic `500` with no internal detail exposed |

Every error above must be exercised by an automated test somewhere in this plan; most are tested in the phase that introduces the corresponding behaviour.

---

## 11. How to Read a Phase

Every phase in §13 uses the same eight sections:

| Section | Meaning |
|---|---|
| **Objective** | Why this phase exists and what it unlocks. |
| **Prerequisites** | Which earlier phases (in any track) must be complete first. |
| **Requirements Covered** | The SRS functional requirement IDs this phase implements, with the SRS wording. |
| **Implementation Tasks** | The behaviour to build, described from the outside — never how to code it. |
| **Expected Input / Output** | The shape of what goes in and what comes out, so you know what "correct" looks like before you write anything. |
| **Test Cases** | Concrete inputs and the outputs that prove the behaviour. Turn each row into an automated test. |
| **Edge Cases** | Inputs and situations that are easy to miss and must not break the system. |
| **Acceptance Criteria** | A checklist. Every box must be true before the phase is considered done and the next one begins. |

Phases also list **Decisions to Confirm** where the specifications leave a choice open. Make the decision, write it with its reasoning into `docs/decisions.md`, and only then implement — do not guess silently.

**Definition of done for every phase:** every test case passes, as an automated test; every edge case has been checked; every decision is logged; anything another track depends on is written into `docs/contracts/`; the work is merged.

---

## 12. Phase Map

| # | Phase | Track |
|---|---|---|
| 0 | Toolchain and Workspace Setup | Foundation |
| 1 | Interface Contracts and Sample Data Freeze | Foundation |
| 2 | Walking Skeleton | Foundation |
| 3 | Synthetic Data Generation and Input Validation | Track 1 |
| 4 | Rule-Based Allocation Agent (Baseline) | Track 1 |
| 5 | Objective Scoring, Weighting and Ranking | Track 1 |
| 6 | Optimization Agent (Constraint-Based Search) | Track 1 |
| 7 | Machine Learning Prediction Component | Track 1 |
| 8 | Traceability, Logging and Performance Validation | Track 1 |
| 9 | Smart Contract Workspace and Deployment Pipeline | Track 2 |
| 10 | Agreement Creation and Booking | Track 2 |
| 11 | Transit Status Tracking and Event Log | Track 2 |
| 12 | Delivery Confirmation, SLA Evaluation, Penalty and Demurrage | Track 2 |
| 13 | Settlement and Contract Closure | Track 2 |
| 14 | Dispute Resolution, Audit Interface and Portability | Track 2 |
| 15 | Backend Foundation: Persistence and Migrations | Track 3 |
| 16 | Authentication, Authorization and Audit Trail | Track 3 |
| 17 | Order Intake and AI/ML Integration | Track 3 |
| 18 | Blockchain Integration: Contract Lifecycle Relay | Track 3 |
| 19 | Real-Time Sync: Event Cache, Push and Resilience | Track 3 |
| 20 | Dashboard Foundation and Shared Components | Track 3 |
| 21 | Overview Screen | Track 3 |
| 22 | Run Optimization Screen | Track 3 |
| 23 | Contracts Screen | Track 3 |
| 24 | Tracking and Settlement Screen | Track 3 |
| 25 | Alerts, Export and UI Polish | Track 3 |
| 26 | End-to-End Flow Validation | Integration |
| 27 | Acceptance Testing and Final Validation | Integration |

---

## 13. Development Phases

# Foundation (Phases 0–2)

---

### Phase 0 — Toolchain and Workspace Setup

**Objective.** Confirm every member can build on their own machine, and establish the shared repository, before any track-specific code exists.

**Prerequisites.** None.

**Requirements Covered.** None directly; this phase enables all later requirements.

**Implementation Tasks**
- Install and version-check every tool in §4.1 on every machine.
- Create the shared Git repository with the folder layout from §6.
- Create empty `docs/contracts/` and `docs/decisions.md`.
- Each member writes a minimal "hello world" in their track's language, run outside Docker.
- Confirm a local PostgreSQL container can be started and queried.

**Expected Input / Output.** Input: nothing. Output: a reachable Git repository with the agreed folder structure, and a short written confirmation (in the README) of the tool versions that worked for each member.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Version check for every required tool | Run each tool's version command | Each prints a version at or above §4.1's minimum |
| Python hello-world service | Start a trivial local web server | A request to it returns `200` |
| Node hello-world script | Run with `node` | Prints its message; exit code `0` |
| Docker sanity check | `docker run hello-world` | Prints the Docker success message |
| PostgreSQL container | Start with a password; connect; run a trivial query | The query returns the expected result |
| Repository access | Each member clones the repo and pushes a branch | The branch is visible to the other two members |

**Edge Cases**
- A tool installed at a version below the minimum — must be caught by the version check before it causes a hard-to-diagnose failure later.
- A member on a different OS (Windows vs macOS vs Linux) — commands must be documented for each, or a documented Docker-only fallback provided.

**Acceptance Criteria**
- [ ] All six test cases pass on all three members' machines.
- [ ] Working tool versions are written into the README.
- [ ] The hello-world code is deleted — it only existed to prove the toolchain.

---

### Phase 1 — Interface Contracts and Sample Data Freeze

**Objective.** Fix the interface between all three tracks in writing, so each member can build the rest of their track without needing the other two to be finished.

**Prerequisites.** Phase 0.

**Requirements Covered.** SRS §4.3 (inter-module structure); Technical Design §7 (interfaces); indirectly, every requirement in this plan depends on this phase being done correctly.

**Implementation Tasks**
- Write, in `docs/contracts/`, the full request/response shape for:
  1. **Backend → AI/ML Engine**: the `optimize` request and the `AllocationPlan` response (§8.1), including every field Track 1 might add (unassigned-order reasons, alternatives, run metadata).
  2. **Backend → Blockchain**: every function listed in §8.2, its inputs, its outputs, and every event it emits, plus the state enum in its fixed order.
  3. **Dashboard → Backend**: every HTTP endpoint, its request/response shape, and which roles may call it.
- Hand-write sample payloads in `samples/`: a small `optimize` request (about 5 orders, 10 wagons, 4 routes), the plan expected back from it, and one reference-example contract's terms (§8.3).
- Make the contracts machine-checkable where practical (for example, a JSON Schema or OpenAPI file per interface), so later phases can validate against them automatically.
- As a team, make every decision listed below and record it.

**Decisions to Confirm**
1. Money unit and currency.
2. **Where the SLA deadline comes from** — the order's stated deadline, or the plan's computed ETA. (Recommended: the order's deadline, since it is the commitment made to the customer.)
3. The specific allocation-agent technique and the specific learning-model task for Track 1 (§1's two deliverables) — choose concretely now, even though they are built in Phases 4–7.
4. What Track 1 returns for orders it cannot place (reason codes) and for rejected malformed input.
5. The HTTP error body and status-code conventions from §8.
6. Which on-chain account may call each contract function (recommended: a single operator/orchestrator account creates agreements; each carrier's own account confirms booking and posts status/delivery, so the chain itself verifies the caller per Technical Design §10.1).
7. Whether Track 3's backend is TypeScript (recommended) or a different language, and whether that choice changes any contract shape (it should not).
8. Numeric performance targets left open by the SRS (§9), if your team wants to set any beyond the stated ones.

**Expected Input / Output.** Input: the SRS and Technical Design. Output: three written interface documents, three (or more) sample payload files, a JSON Schema (or equivalent) per interface, and a decisions log with entries 1–8 above.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Each sample payload validated against its schema | The hand-written samples | All pass validation |
| A deliberately broken sample (missing field, wrong type, `priority: 9`) | A corrupted copy of a sample | Fails validation, with a message pointing at the broken field |
| A member builds a stub for a track they do not own, using only the contracts doc | The contracts doc, no other input | They can do it without asking a question — if not, the doc is missing something |
| State enum order in the contracts doc | Compare against Technical Design §8.2 | Identical order |
| Every function in Technical Design §4.2 and §5.1 | Checklist against the contracts doc | Each appears in the doc, or is explicitly marked "deferred" with a reason |

**Edge Cases**
- A field that one track assumes is optional and another assumes is required — must be resolved explicitly in the doc, not left ambiguous.
- A decision that affects money (unit, rounding) left unstated — this must not happen; it is decision 1 above and is non-negotiable before Phase 1 closes.

**Acceptance Criteria**
- [ ] All three members have read and agreed to all three interface documents.
- [ ] Decisions 1–8 are in `docs/decisions.md` with a one-line reason each.
- [ ] Sample payloads exist and validate against their schemas.

---

### Phase 2 — Walking Skeleton

**Objective.** Get the thinnest possible version of the entire system running end to end, with one command, before any real logic exists in any track — so every later addition is an increment on something that already runs.

**Prerequisites.** Phase 1.

**Requirements Covered.** SRS Reliability NFR (degraded-service behaviour); Technical Design §10.3 (single docker-compose for the whole system).

**Implementation Tasks**
- **Track 1 stub**: a health endpoint, and an `optimize` endpoint that returns the canned sample plan from Phase 1 regardless of input, after checking the request matches the schema.
- **Track 2 stub**: a local chain running, with a minimal placeholder contract deployed; its address and ABI written to a file the backend can read.
- **Database**: running, with credentials from environment variables.
- **Track 3 backend stub**: a health endpoint that reports its own status and whether Track 1 and Track 2 are reachable — missing dependencies must produce a *degraded* status, never a crash.
- **Track 3 dashboard stub**: one page showing a labelled status indicator per service, fed from the backend's health endpoint.
- Wire everything together with Docker Compose; every machine-specific setting is an environment variable with a safe default.

**Expected Input / Output.** Input: `docker compose up --build` on a clean clone. Output: all services reachable; the dashboard's single page shows the true status of every service, including correctly showing "degraded" when a dependency is stopped.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Clean clone, Docker only installed | `docker compose up --build` | All services start; Compose reports each healthy |
| Track 1 health check | `GET` the health endpoint | `{"status":"ok"}` (per your frozen shape) |
| Track 1 optimize stub | The sample request from Phase 1 | JSON-equal to the sample plan |
| Track 1 optimize stub, malformed body | A request missing `orders` | `4xx` with a validation message, not a crash |
| Track 2 chain | JSON-RPC `eth_blockNumber` | Returns a hex block number |
| Track 2 placeholder contract | After startup | The address/ABI file exists; the address has code on-chain |
| Backend health, everything up | `GET /health` | `status: ok`; every dependency listed as up |
| Stop the Track 1 container | Wait up to 10 seconds, then re-check | `status: degraded`; Track 1 named as the down dependency; HTTP status is still `200` |
| Restart the Track 1 container | Re-check | Returns to `status: ok` |
| Dashboard status page | Load it with one dependency stopped | Shows that service as down, with both a colour and a text label |
| `docker compose down -v` then `up` again | Clean teardown and restart | No leftover state; everything starts clean |

**Edge Cases**
- Two dependencies down at once — the health response must list both, not just the first one found.
- A dependency that is up but answers slowly — the health check must time out and report "down" rather than hang indefinitely.
- A container that fails to start at all (bad config) — Compose must surface this clearly, not fail silently.

**Acceptance Criteria**
- [ ] Any member can clone the repository, run one command, and see every service reported correctly, including degraded states.
- [ ] Killing any single service never crashes the backend or the dashboard.
- [ ] This skeleton is never thrown away — every later phase builds directly on top of it.

---

# Track 1 — AI/ML Allocation Engine (Python)

Owner: the member responsible for optimization and machine learning. Requirements: FR-A1 – FR-A8. Build the core as pure functions, independent of the HTTP layer, so they can be tested without a running web server.

---

### Phase 3 — Synthetic Data Generation and Input Validation

**Objective.** Produce believable test data on demand, and reject malformed input cleanly. Every later Track 1 phase depends on this.

**Prerequisites.** Phase 1.

**Requirements Covered.** FR-A1 ("accept a set of freight orders … as optimization input"); FR-A2 ("accept wagon/rake master data … and route master data … as optimization input").

**Implementation Tasks**
- A data generator that produces orders (cargo type, quantity, destination, priority 1–3, deadline), wagons (ID, capacity, type, location, availability), and routes (origin, destination, distance, average transit time) from a size parameter and a random seed.
- Make deadlines realistic: a mix of comfortable, tight, and a few that are effectively impossible.
- Support two named scenarios: **plentiful** (available capacity comfortably exceeds demand) and **scarce** (demand is roughly double the available capacity) — Phase 6 needs the scarce one to demonstrate value.
- Validation functions for orders and for master data: accept well-formed records, and for each malformed record return a reason code without discarding the rest of the batch.

**Decisions to Confirm.** The set of wagon types and cargo types you model, and the compatibility rule between them (needed concretely in Phase 6, but the data model is decided here); your base location(s) for synthetic data.

**Expected Input / Output.**
- Input to the generator: a record count and a seed (and a scenario name).
- Output: three lists — orders, wagons, routes — each matching the schema frozen in Phase 1.
- Input to validation: a raw list of records (possibly malformed). Output: a list of valid records and a separate list of `{id, reason}` rejections.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Deterministic generation | Size 25, seed 1, run twice | Byte-identical output both times |
| Different seeds | Size 25, seeds 1 and 2 | Different output |
| Record count | Size 25 | Exactly 25 orders generated |
| Field validity across a generated set | Any generated set | Every priority is in {1,2,3}; every quantity is > 0 |
| Routability | Any generated set | Every order's destination has at least one matching route |
| Plentiful scenario | Generate with `scenario="plentiful"` | Total available capacity ≥ 1.2 × total demand |
| Scarce scenario | Generate with `scenario="scarce"` | Total available capacity ≤ 0.6 × total demand |
| Reject negative quantity | An order with `quantity: -5` | Rejected with reason `BAD_QUANTITY`; other orders in the batch still accepted |
| Reject bad priority | An order with `priority: 9` | Rejected with reason `BAD_PRIORITY` |
| Reject missing field | An order missing `destination` | Rejected, reason names the missing field |
| Reject bad deadline | An order with an unparseable deadline | Rejected with reason `BAD_DEADLINE` |
| Reject bad master data | A wagon with capacity `0`, or a route with negative distance | Rejected with a reason |
| Empty input | An empty order list | Accepted as a valid (trivial) input; no crash |

**Edge Cases**
- An order whose destination has no route at all — must not be rejected at validation (it is a valid order); it becomes `unassignable` later, in Phase 4.
- A wagon marked unavailable — must still pass validation (it is a valid record); availability is used later, not at validation time.
- A duplicate ID across two records — define and test the behaviour (recommended: reject the second occurrence with a reason).

**Acceptance Criteria**
- [x] Every rejection path above has a passing automated test.
- [x] Both named scenarios can be generated with one call each and saved as sample files for later phases.

---

### Phase 4 — Rule-Based Allocation Agent (Baseline)

**Objective.** Produce a correct, simple, explainable allocation before attempting anything sophisticated. This phase's output is what Phase 3's sample plan should now match exactly, and it unblocks Track 3's integration work immediately.

**Prerequisites.** Phase 3.

**Requirements Covered.** FR-A3 ("generate an allocation plan that assigns orders to wagons/rakes and routes, subject to capacity, route, and deadline constraints") — baseline implementation; FR-A7 ("allow an accepted plan to be exported … and handed to the contract-generation function").

**Implementation Tasks**
- Implement a deterministic, rule-based agent: for each order, in a defined order, select a route to its destination and enough compatible, available wagons at the route's origin to cover the order's quantity.
- Compute a departure time and an ETA from a plan start time and the chosen route's transit time.
- Record, for every order that cannot be placed, a reason code (no route available, insufficient wagon capacity, and so on).
- Serialize the result into the exact `AllocationPlan` shape frozen in Phase 1.
- Replace the Phase 2 stub behind the `optimize` endpoint with this real implementation.

**Decisions to Confirm.** The order in which orders are processed (affects which orders get placed first when capacity is tight); any loading/dwell time added before departure; how ties between equally good routes are broken.

**Expected Input / Output.** Input: the validated output of Phase 3 plus a weights object (accepted but not yet meaningfully used — see Phase 5). Output: an `AllocationPlan` as frozen in Phase 1, including `unassignedOrders`.

**Test Cases** (treat each as an *invariant*, checked over many generated datasets, not just one)

| Test Case | Input | Expected Result |
|---|---|---|
| No wagon reused | Any generated dataset | No wagon ID appears in two different assignments |
| Capacity respected | Any generated dataset | For every assignment, the summed wagon capacity ≥ the order's quantity |
| Route/location consistency | Any generated dataset | The chosen route's origin matches the assigned wagons' location, and its destination matches the order's destination |
| Every order accounted for | Any generated dataset | Every order is either assigned, or listed in `unassignedOrders` — never silently dropped |
| Capacity shortage | 1 wagon, 10 orders | Some orders unassigned with reason `INSUFFICIENT_WAGONS` |
| No route available | An order to a destination with no matching route | Unassigned with reason `NO_ROUTE` |
| Unavailable wagons excluded | A wagon marked unavailable | Never appears in any assignment |
| Determinism | Same input, run twice | Identical output |
| Schema conformance | Any output | Validates against the `AllocationPlan` schema from Phase 1 |
| Via HTTP: plentiful dataset | `POST` to the optimize endpoint | `200` and a schema-valid plan |
| Via HTTP: malformed body | A request with a missing field | `4xx` with a validation message |

**Edge Cases**
- An order whose quantity exceeds the capacity of *every available wagon combined* — must be reported unassigned, not cause a crash or an infinite loop.
- All wagons unavailable — every order is unassigned, with a clear reason, and the plan still returns a valid (if empty) response rather than erroring.
- Two orders competing for the same last wagon — the behaviour must be deterministic (same winner every run with the same input), not a race.

**Acceptance Criteria**
- [x] All invariant tests pass across at least 50 randomly seeded datasets, not just one fixed example.
- [x] The real `optimize` endpoint is live and Track 3 can now integrate against it instead of the stub.

---

### Phase 5 — Objective Scoring, Weighting and Ranking

**Objective.** Build the machinery that makes the dashboard's weight sliders (on-time, cost, utilization) actually change the result, and let a caller compare more than one candidate plan.

**Prerequisites.** Phase 4.

**Requirements Covered.** FR-A4 ("rank and prioritize orders according to configurable weights"); FR-A5 ("report … wagon utilization %, estimated cost, estimated distance, and on-time delivery probability" — metrics computed here, on-time probability refined in Phase 7); FR-A6 ("allow a planner to re-run optimization with adjusted parameters (what-if) before accepting a plan").

**Implementation Tasks**
- A scoring function: given any candidate plan, compute wagon utilization %, estimated cost, total distance, and a first (simple) on-time measure.
- A ranking function: given several candidate plans and a weights object, compute one combined score per candidate, normalize the weights so any non-negative numbers are accepted, select the best candidate, and return the rest as ranked alternatives.
- A way to generate more than one candidate from the same input (for example, by varying the order-processing sequence from Phase 4), so there is something to rank.
- Ensure a plan cannot win purely by being cheap while dropping orders — the share of orders successfully placed must factor into the score.

**Decisions.** Confirmed by Alim: 250 paise per wagon-kilometre; on-time probability, utilization/100, and inverse normalized cost scaled to `[0, 1]`; all-zero weights mean equal thirds; coverage takes precedence over weighted metrics; four deterministic candidates with at most three alternatives. The exact formula and the deadline-slack heuristic are recorded in [the AI engine contract](contracts/ai-engine.md) and [decision log](decisions.md).

**Expected Input / Output.** Input: several candidate plans (internal representation) plus a weights object. Output: the same plans, each annotated with its metrics and its combined score, sorted best-first; the `AllocationPlan` response now includes populated `metrics` and `alternatives`.

**Test Cases** (use **hand-built** candidate plans with known properties, not the agent's own output, so the ranker's correctness is tested in isolation)

Candidate X: cheap, 60% on-time. Candidate Y: expensive, 95% on-time. Equal utilization.

| Test Case | Weights (on-time, cost, utilization) | Expected Result |
|---|---|---|
| On-time prioritized | `(1, 0, 0)` | Y wins |
| Cost prioritized | `(0, 1, 0)` | X wins |
| All equal | `(1, 1, 1)` | A result is produced; it must be the same result every time this exact input is run |
| All zero | `(0, 0, 0)` | Treated as equal thirds; no error, no divide-by-zero |
| Scale invariance | `(2, 1, 1)` vs `(0.5, 0.25, 0.25)` | Identical ranking (weights are normalized) |
| Negative weight | `(-0.1, 1, 1)` | Rejected with a validation error |

| Test Case | Input | Expected Result |
|---|---|---|
| Alternatives ordering | Any set of candidates | Sorted by score, best first; none identical to the selected plan |
| Coverage matters | A plan assigning half the orders very cheaply, vs. a plan assigning all orders at higher cost, equal weights | The full-coverage plan is not beaten purely on cost |
| Empty plan | A candidate with zero assignments | Metrics are all zero; no crash |
| Hand-computed check | A small plan (1 order, 3 wagons, a known distance, your cost rate) | Utilization, cost and distance exactly match a manual calculation |
| What-if | Same orders/wagons/routes, two different weight sets, two separate calls | Two different run/plan IDs; the first result is unchanged by the second call |

**Edge Cases**
- Only one candidate plan exists — ranking must still work and return zero alternatives, not error.
- Two candidates with an exactly tied score — the tiebreak must be deterministic.
- A weights object with only one non-zero weight — normalization must not divide by zero or distort the result.

**Acceptance Criteria**
- [x] All ranker tests pass against the hand-built candidates.
- [x] Metrics on a small, manually checkable plan match a hand calculation exactly.
- [x] Weights are validated at the HTTP boundary, not just internally.

---

### Phase 6 — Optimization Agent (Constraint-Based Search)

**Objective.** Deliver the headline allocation capability: an agent that searches for a near-optimal allocation rather than following a fixed rule, and that demonstrably outperforms the Phase 4 baseline when wagon capacity is scarce. This is the concrete "AI-agent algorithm" referred to in the brief.

**Prerequisites.** Phases 3–5.

**Requirements Covered.** FR-A3 (full implementation — "subject to capacity, route, and deadline constraints"); FR-A4 (the agent optimizes directly against the weighted objective, not just a fixed rule order).

**Implementation Tasks**
- Implement a search/constraint-based agent (Technical Design §3.4 suggests CP-SAT or a Genetic Algorithm; a hybrid is also acceptable) that produces candidate allocations honouring:
  - every placed order's wagons combined cover its quantity;
  - a wagon serves at most one order per plan;
  - the chosen route connects the wagons' location to the order's destination;
  - wagon type is compatible with cargo type, per the Phase 3 compatibility rule;
  - when not everything fits, higher-priority orders are placed before lower-priority ones;
  - a configurable time budget is respected, returning the best feasible plan found even if the search is stopped early.
- Feed the agent's candidates into the Phase 5 scoring/ranking machinery, so weights still control the final choice.
- Add the new unassigned-order reason for a type mismatch.

**Decisions.** Alim approved deterministic OR-Tools CP-SAT, the Phase 4 greedy plan as a warm-start incumbent, and a 1-second default budget with bounded caller overrides from 0.05 to 10 seconds. The solver uses one search worker and seed 0 for reproducibility. Higher-priority assignment counts are optimized lexicographically before metric weighting.

**Expected Input / Output.** Input: identical to Phase 4's `optimize` request, plus an optional time-budget override. Output: identical `AllocationPlan` shape; internally, the candidate(s) now come from the search agent instead of (or alongside) the rule-based one.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Priority respected under scarcity | The *scarce* dataset from Phase 3 | Every priority-1 order is placed before any priority-3 order is dropped |
| Beats the baseline | The *scarce* dataset, same weights, both agents run | The search agent's weighted score is never worse than the Phase 4 baseline's |
| Demonstrable advantage | The *scarce* dataset, varied weights | On at least one dataset and one weighting, the search agent is strictly better than the baseline on at least one metric — save this as a demo artifact |
| Weight sensitivity | *Scarce* dataset, weights `(1,0,0)` then `(0,1,0)` | On-time % of the first run ≥ the second; estimated cost of the second ≤ the first |
| Type compatibility | An order needing a wagon type that is unavailable | Unassigned, reason `INCOMPATIBLE_WAGON_TYPE` |
| No route | An order to a destination with no route | Unassigned, reason `NO_ROUTE` |
| Scale | 300 orders, *plentiful* dataset | A valid plan is returned in under the performance target from §9 |
| Determinism | Same input and seed, run twice | Same objective value both times |
| Time budget respected | A hard (scarce, large) instance with a 1-second budget | Returns a feasible plan within roughly 1.5 seconds, not an error |
| Baseline invariants still hold | Any search-agent output | Every invariant tested in Phase 4 (no wagon reuse, capacity respected, route consistency) still holds |

**Edge Cases**
- A dataset with no feasible solution at all (demand impossible to meet under any assignment) — the agent must return a plan with everything unassigned and clear reasons, not fail or hang.
- The time budget expires before any feasible solution is found — must return cleanly (empty or partial plan with reasons), not throw an unhandled error.
- A dataset small enough that the search agent and the baseline produce the exact same plan — this is a valid outcome, not a bug; tests should allow for it.

**Acceptance Criteria**
- [x] Search, priority, compatibility, determinism, budget, scale, and allocation-invariant tests pass.
- [x] A saved scarce-capacity sample demonstrates a higher on-time probability and full order coverage than the Phase 4 baseline.
- [x] The new `INCOMPATIBLE_WAGON_TYPE` reason code is included in the AI engine contract and schema.

---

### Phase 7 — Machine Learning Prediction Component

**Objective.** Add the second deliverable of Track 1: a learned model that improves on a hand-coded estimate. This is the concrete "ML (learning algorithm)" referred to in the brief, and it directly strengthens FR-A5's on-time-probability figure.

**Prerequisites.** Phase 6 (the component should plug into the agent's existing pipeline, not stand alone).

**Requirements Covered.** FR-A5 ("estimated … on-time delivery probability") — the learned, variability-aware version.

**Implementation Tasks**
- Define a concrete prediction target that the agent currently estimates crudely — recommended: *the probability that a given order's delivery completes before its deadline*, accounting for variability in transit time rather than treating the route's average transit time as exact.
- Generate or assemble training data: either simulate many transit-time outcomes per route (synthetic) or use Phase 8's run log once it exists as a growing historical source.
- Train a model (a simple, well-understood technique is appropriate — this is a prototype, not a production ML system) that maps order/route features to the prediction target.
- Integrate the trained model's output into the scoring step from Phase 5, replacing or supplementing the simple on-time measure.
- Handle the model being unavailable or untrained (for example, on a fresh install) by falling back to a clearly-labelled simple estimate rather than failing the whole optimize call.

**Decisions to Confirm.** The exact prediction target and its label source (recommended above, but confirm); the training/validation split strategy; the acceptable error tolerance; how often the model is retrained and on what trigger; how model version is recorded against each run (needed for Phase 8's traceability).

**Decisions.** Alim approved per-order probability of on-time delivery, trained from deterministic synthetic lognormal transit simulations. Use an 80/20 stratified holdout split with seed 42 and require held-out probability MAE ≤ 0.10 against the simulator's known probability. Retrain explicitly with `python ai-engine/train_prediction_model.py` when the synthetic assumptions or training data change. Derive the model version from the training-data hash and fitted parameters; use the existing labelled heuristic whenever the artifact is unavailable or an assigned cargo category is not represented by the model.

**Expected Input / Output.** Input for training: a dataset of past (or simulated) orders/routes with known outcomes. Input for inference: one order/route pair (or a batch) as already available inside the optimize pipeline. Output: a probability (0–1) per order, used by the scoring step; plus an indicator of whether the real model or the fallback estimate was used.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Boundary case: huge slack | An order with deadline far beyond the route's average transit time | Predicted on-time probability close to 1 |
| Boundary case: huge deficit | An order whose deadline is far earlier than the route's average transit time | Predicted on-time probability close to 0 |
| Monotonic sensitivity | Two otherwise-identical orders, one with more slack than the other | The one with more slack gets a probability no lower than the one with less |
| Determinism at inference time | Same order/route pair, same trained model, predicted twice | Identical prediction both times |
| Held-out accuracy | A held-out test split not used in training | Prediction error is within the tolerance decided above |
| Model unavailable | Inference requested with no trained model present | A clearly-labelled fallback estimate is returned, not an error, and the response indicates the fallback was used |
| Unseen category | An order with a cargo type or route not seen during training | A reasonable prediction is still returned (no crash), and the response does not claim unwarranted confidence |
| Integration with scoring | A full optimize call, before and after this phase | The plan's on-time metric changes to reflect the learned prediction, and the ranking under an on-time-heavy weighting can change as a result |
| Performance | A batch of predictions for 300 orders | Returns within a small fraction of the overall optimize time budget (§9) |

**Edge Cases**
- Training data with very few examples for a particular route — the model (or its fallback logic) must not silently overfit to a tiny sample without some signal that confidence is low.
- A route added after training with no historical data at all — must be handled by the fallback path, not by guessing confidently.
- Extreme or corrupted feature values reaching inference (for example, a negative transit time slipping through) — must be rejected or clamped, not passed silently into the model.

**Acceptance Criteria**
- [x] The boundary-case and monotonicity tests pass.
- [x] Held-out probability MAE is recorded and meets the agreed tolerance.
- [x] The fallback path is exercised by an automated test and never throws.
- [x] The contracts doc notes which field in the response indicates real-model vs. fallback.

---

### Phase 8 — Traceability, Logging and Performance Validation

**Objective.** Make every run reproducible after the fact, and prove the whole Track 1 pipeline — baseline agent, search agent, and ML component together — meets its performance target.

**Prerequisites.** Phase 7.

**Requirements Covered.** FR-A8 ("log every optimization run with its input snapshot, algorithm/parameters used, and timestamp for traceability"); the Performance NFR from §9.

**Implementation Tasks**
- For every run (including what-if re-runs), record: a run ID, a timestamp, which agent technique was used and its parameters (including the weights and the time budget), which ML model version was used (or that the fallback was used), input counts, a hash of the input, and the resulting plan ID.
- *(Optional)* expose a way to fetch one run record by ID.
- Run the full pipeline (data generation → agent → ML prediction → scoring → ranking → export → log) end to end against the performance target.

**Storage decision.** Track 1 owns a local SQLite run log so it remains independently deployable; the Platform remains responsible for operational data and accepted-plan persistence.

The service accepts `AI_RUN_LOG_PATH`; Compose persists it in the dedicated `ai-run-logs` volume. `GET /v1/runs/{runId}` retrieves a record without coupling the engine to Track 3's PostgreSQL. Each record contains the validated input snapshot and hash, timestamps/runtime, selected algorithm and parameters, model/fallback identity, counts, plan ID, status, and failure diagnostics when applicable.

**Expected Input / Output.** Input: any optimize call. Output: in addition to the `AllocationPlan`, exactly one new run-log record per call, retrievable by its run ID.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Log completeness | Any single optimize call | Exactly one new log record; every field listed above is present and non-empty |
| Input hash stability | Two calls with identical input | Identical input hash; different run IDs |
| Input hash sensitivity | Two calls differing in one field of one order | Different input hashes |
| What-if traceability | Same input, two different weight sets | Two separate, complete log records, each referencing its own resulting plan |
| End-to-end performance | 300 orders, *plentiful* scenario, full pipeline including the ML component | Completes within the target in §9 |
| End-to-end performance under scarcity | 300 orders, *scarce* scenario, full pipeline | Still completes within the target, or the time-budget behaviour from Phase 6 kicks in cleanly |

**Edge Cases**
- A run that fails partway through (for example, the ML component throws) — the failure must still be logged with enough detail to diagnose it, not silently lost.
- Very high call volume in a short period — the log must not become a bottleneck that slows down the optimize call itself.

**Acceptance Criteria**
- [x] Every run, including what-ifs and failed executions, appears in the log exactly once, fully populated.
- [x] The measured end-to-end time at the target scale is recorded in the README.
- [x] Track 1 is feature-complete and independently testable/deployable, with no runtime dependency on Track 2 or Track 3.

---

# Track 2 — Blockchain Settlement Layer (Solidity)

Owner: the member responsible for the smart contract. Requirements: FR-B1 – FR-B9. The contract is a state machine; every transition is one function call that emits an event and appends to a queryable history.

```
Created → Booked → InTransit → Delivered → PenaltyCalculated → PaymentReleased → Closed
                                   ↘              ↘
                                     Disputed  ⇄ (returns into the lifecycle on resolution)
```

**General rule for this track:** every failure must have its own distinct, named error (unauthorized caller, wrong state, unknown contract, invalid terms, and so on), so tests can tell failures apart and so Track 3 can map each one to a precise HTTP status.

---

### Phase 9 — Smart Contract Workspace and Deployment Pipeline

**Objective.** Get the full loop — write, compile, test, deploy, inspect — working with a trivial contract before any freight logic exists.

**Prerequisites.** Phase 1.

**Requirements Covered.** Technical Design §4.3 (deployment options).

**Implementation Tasks**
- Set up the contract project: compiler version, a local chain for development, and (optionally) a public testnet configuration for a live demo.
- Write a near-empty contract (one stored value, one setter) to prove the full loop works.
- Write a deploy script that prints the deployed address and writes the address and ABI to a file Track 3 will read.
- Become comfortable with test helpers for advancing the chain's clock and for acting from multiple accounts — later phases depend on both.

**Expected Input / Output.** Input: a compiler and chain configuration. Output: a compiled contract, a passing trivial test suite, a deployed address, and an address/ABI file on disk.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Compile | The trivial contract | Succeeds with no unexplained warnings |
| Trivial test suite | Run it | Passes |
| Deploy locally | Run the deploy script against the local chain | Prints an address; the address/ABI file exists and contains both |
| Code presence | JSON-RPC `eth_getCode` on the deployed address | Non-empty |
| Time travel | A test that advances the chain's clock by 1 hour | The next block's timestamp is at least 3,600 seconds later |
| Multiple accounts | A test using a second account to call the setter | Works; both accounts are distinguishable in the test output |

**Edge Cases**
- Re-running the deploy script — must not silently fail or deploy an unexpected duplicate without the operator noticing (decide and document the expected behaviour: redeploy vs. refuse).
- A compiler version mismatch between two members' machines — must be pinned in configuration, not left to each machine's default.

**Acceptance Criteria**
- [ ] Compile → test → deploy works with three commands, documented in the README.
- [ ] The trivial contract is deleted once the workspace is proven; it is not part of the final system.

---

### Phase 10 — Agreement Creation and Booking

**Objective.** Build the data model and the first two lifecycle transitions: creating an agreement from an accepted plan, and the carrier confirming it.

**Prerequisites.** Phase 9.

**Requirements Covered.** FR-B1 ("create an on-chain freight agreement … from an accepted allocation plan, capturing cargo, route, rate, SLA deadline, and penalty/demurrage terms"); FR-B2 ("allow the carrier to confirm booking, moving the contract to a Booked state"); FR-B8 (start); FR-B9 ("expose contract state and terms via a read interface").

**Implementation Tasks**
- Define the state enum in the exact frozen order (§8).
- Define the terms stored per agreement: freight value, SLA deadline, penalty rate per delay block and the block length, free holding hours, demurrage rate per wagon per hour, wagon count, and a hash of the full off-chain terms document.
- `createAgreement(planId, shipper, carrier, terms)`: stores everything, assigns the next contract ID, starts in `Created`, emits an event, returns the ID and an agreement hash.
- `confirmBooking(contractId)`: `Created → Booked`, callable by the carrier's own account only.
- `getContractStatus(contractId)`: returns the agreement and its full event history.
- A queryable history mechanism (on-chain list, or event-based, or both) satisfying FR-B8/FR-B9 together.

**Decisions to Confirm.** Who may call `createAgreement` (recommended: a single orchestrator/operator account only); validation rules for terms at creation (block length > 0, freight value > 0, SLA deadline in the future); whether history is kept on-chain, reconstructed from events, or both.

**Expected Input / Output.** Input: a plan ID, shipper address, carrier address, and the terms struct. Output: a contract ID and an agreement hash; subsequently, `getContractStatus` returns the full agreement and history for that ID.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Create agreement | Orchestrator account, valid terms | Returns ID `1`; state `0`; terms readable exactly as given; event emitted; history has 1 entry |
| Second agreement | Same accounts, a second `createAgreement` call | Returns ID `2`; the first agreement is unchanged |
| Hash consistency | Two agreements with identical input | Equal agreement hash; a third agreement with any differing field produces a different hash |
| Unauthorized creation | A non-orchestrator account calls `createAgreement` | Reverts with a distinct "not authorized" error |
| Invalid terms | Block length `0`, or freight value `0`, or an SLA deadline in the past | Reverts with a distinct "invalid terms" error |
| Confirm booking | State `0`, called by the carrier account | State becomes `1`; booking event emitted; history has 2 entries |
| Wrong caller | State `0`, called by a non-carrier account | Reverts with a distinct "not the carrier" error |
| Double booking | State `1`, `confirmBooking` called again | Reverts with a distinct "invalid state" error |
| Unknown contract | Any function called with an ID that was never created | Reverts with a distinct "unknown contract" error |
| Read interface | Any created contract | `getContractStatus` returns the agreement and history in chronological order |
| Isolation between contracts | Two agreements exist; act on one | The other is completely unaffected |

**Edge Cases**
- Terms with a zero wagon count — decide and test whether this is valid (an agreement with no physical wagons attached might be invalid; document the choice).
- An attempt to read a contract ID of `0` — must be rejected as unknown, since IDs are assigned starting at `1`.
- Two different shipper/carrier addresses pointing at the same underlying account — not a special case to prevent, but confirm the contract does not assume they differ.

**Acceptance Criteria**
- [ ] Every row above is an automated, passing test.
- [ ] The state values returned to a test client match the enum frozen in `docs/contracts/` exactly.

---

### Phase 11 — Transit Status Tracking and Event Log

**Objective.** Record what happens between booking and delivery, including the timestamp Phase 12 will need to compute how long wagons were held.

**Prerequisites.** Phase 10.

**Requirements Covered.** FR-B3 ("record shipment status transitions … against the contract"); FR-B8 (continued).

**Implementation Tasks**
- `updateShipmentStatus(contractId, status, timestamp)`: the first update after booking moves the contract to `InTransit`; later updates are recorded without changing state further.
- Apply the same guard pattern as Phase 10 (unauthorized caller, wrong state, unknown contract each produce a distinct error).

**Decisions to Confirm.** The fixed set of allowed status values (recommended: `Dispatched`, `CheckpointReached`, `ArrivedAtDestination`); who may post updates (recommended: the carrier's own account, so the chain verifies the caller per Technical Design §10.1); whether a status update with an earlier timestamp than the previous one is rejected (recommended: yes).

**Expected Input / Output.** Input: a contract ID, a status value from the allowed set, and a timestamp. Output: an updated history; on the first update after booking, an updated state.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| First update after booking | Booked contract, carrier posts `Dispatched` | State becomes `2`; status event emitted; history +1 |
| Subsequent update | InTransit contract, carrier posts `CheckpointReached` | State remains `2`; history +1 |
| Update too early | `Created` contract (never booked), carrier posts an update | Reverts with "invalid state" |
| Wrong caller | Booked contract, a non-carrier account posts an update | Reverts with "not the carrier" |
| Timestamp regression | InTransit contract, an update with an earlier timestamp than the last recorded one | Reverts |
| Disallowed status value | A status string not in the allowed set | Reverts |
| History order | Any contract with several updates | `getContractStatus` returns them in chronological order, each with its actor and timestamp |
| Event-and-history pairing | Every state-changing function built so far | Each one both emits an event and appends a history entry — verify both in the same test |

**Edge Cases**
- Two updates posted with the exact same timestamp — decide and test whether this is accepted (recommended: accepted, since it is not technically a regression).
- A status update posted after delivery (once Phase 12 exists) — out of scope for this phase, but note it as a constraint Phase 12 must enforce.

**Acceptance Criteria**
- [ ] All Phase 10 tests still pass unmodified.
- [ ] Every state-changing function introduced so far is covered by the "event and history" pairing test.

---

### Phase 12 — Delivery Confirmation, SLA Evaluation, Penalty and Demurrage

**Objective.** Implement the core promise of the project: the contract itself decides whether delivery was late and computes the resulting deductions, from stored terms and observed timestamps alone, so anyone can recompute the same numbers independently.

**Prerequisites.** Phase 11.

**Requirements Covered.** FR-B4 ("allow delivery confirmation with a timestamp and proof-of-delivery reference"); FR-B5 ("automatically evaluate delivery time against the SLA deadline and compute a penalty and/or demurrage amount when the SLA is breached").

**Implementation Tasks**
- `confirmDelivery(contractId, timestamp, podReference)`: `InTransit → Delivered`.
- `evaluateSLA`: determine whether delivery was on time, and if not, by how many seconds.
- `calculatePenalty` and `calculateDemurrage`: pure functions of the stored terms and the observed timestamps (Technical Design §4.4).
- Store both computed amounts, emit events for each, and end in state `PenaltyCalculated` — every delivery follows this one path, even when both amounts are zero.

```
penalty   = freightValue × penaltyBpsPerBlock / 10,000 × ceil(secondsLate / (blockHours × 3600))
demurrage = wagonCount × ratePerWagonHour × (hours held beyond free time, rounded up to whole hours)
```

**Decisions to Confirm.**
1. Where "hours held" comes from — recommended: the time between an `ArrivedAtDestination` status update and the delivery confirmation timestamp, since that is auditable from the history built in Phase 11.
2. Whether total deductions are capped at the freight value (recommended: yes, so net payment can never go negative and an unsigned subtraction can never lock the contract).
3. Rounding of partial hours (the formula above rounds up).
4. Who is trusted to supply the delivery timestamp in the prototype (recommended: the carrier, which allows simulating lateness for demo/testing purposes — record this as a known prototype simplification).

**Expected Input / Output.** Input: a contract ID, a delivery timestamp, and a proof-of-delivery reference. Output: the contract's state becomes `PenaltyCalculated`; the penalty and demurrage amounts are stored and readable via `getContractStatus`.

**Test Cases** — reference example from §8.3 (freight 2,500,000; deadline 2026-01-08T06:00:00Z; 12 wagons; free time 6 hours):

| # | Delivered at | Hours held | Late by | Blocks | Penalty | Demurrage |
|---|---|---|---|---|---|---|
| A | 2026-01-08 05:00:00 | 4 | none | 0 | **0** | **0** |
| B | 2026-01-08 06:00:00 (exactly the deadline) | 6 | 0 | 0 | **0** | **0** |
| C | 2026-01-08 06:00:01 | 6 | 1 s | 1 | **50,000** | **0** |
| D | 2026-01-08 12:00:00 | 6 | 6 h | 1 | **50,000** | **0** |
| E | 2026-01-08 12:00:01 | 6 | 6 h 1 s | 2 | **100,000** | **0** |
| F | 2026-01-08 19:00:00 | 10 | 13 h | 3 | **150,000** | **24,000** |
| G | 2026-01-08 06:00:00 | 6.5 | 0 | 0 | **0** | **6,000** (0.5 h over free time rounds up to 1 h) |
| H | 2026-01-24 22:00:00 | 6 | 400 h | 67 | 3,350,000 uncapped → **2,500,000 capped** | **0** |

| Test Case | Input | Expected Result |
|---|---|---|
| Empty proof reference | InTransit contract, `confirmDelivery` called with an empty reference | Reverts |
| Delivery without transit | Booked contract (never dispatched), `confirmDelivery` | Reverts with "invalid state" |
| Double delivery | Already-delivered contract, `confirmDelivery` called again | Reverts with "invalid state" |
| Vector F, full check | Deliver as in row F | State `4`; delivery event, then penalty event (150,000), then demurrage event (24,000), in that order |
| Vector A, full check | Deliver as in row A | State `4`; both amounts recorded as `0` |
| Vector H, full check | Deliver as in row H | Penalty stored as `2,500,000` (capped); no revert |

**Edge Cases**
- A delivery timestamp earlier than the `ArrivedAtDestination` status — this should not be possible if status updates are enforced monotonically (Phase 11), but confirm it is actually prevented end to end.
- Exactly on the boundary of a penalty block (for example, exactly 6 hours late) — vector D above tests this; confirm your implementation does not accidentally count it as 2 blocks or 0.
- A contract whose terms have a demurrage rate of `0` — penalty must still apply normally; demurrage correctly computes to `0` regardless of hours held.

**Acceptance Criteria**
- [ ] All eight reference vectors pass as automated tests.
- [ ] Every decision above is recorded with its reasoning in `docs/decisions.md`.

---

### Phase 13 — Settlement and Contract Closure

**Objective.** Turn the computed deductions into a final, one-time payout record, and lock the contract against further change.

**Prerequisites.** Phase 12.

**Requirements Covered.** FR-B6 ("automatically trigger payment release when delivery is confirmed and all contract conditions are satisfied, net of any computed penalty/demurrage").

**Implementation Tasks**
- `releasePayment(contractId)`: net = freight value − penalty − demurrage; only callable once, only after `PenaltyCalculated`.
- `closeContract(contractId)`: callable only after release; terminal — no further state-changing call may succeed afterward.

**Decisions to Confirm.** What "payment" means in the prototype — SRS §1.2 rules out real-money settlement, so recommended is **accounting only**: the net amount is recorded in an event, and Track 3 stores a reference (for example, a transaction hash) as the authoritative payment reference (Technical Design §8.1). An escrowed-token upgrade is optional and should not be assumed. Also decide whether release happens automatically at the end of Phase 12's flow or as a separate call (recommended: separate, so a failure can be retried without re-triggering penalty calculation).

**Expected Input / Output.** Input: a contract ID already in `PenaltyCalculated`. Output: state becomes `PaymentReleased`, then `Closed`; the net amount is readable via `getContractStatus`.

**Test Cases** (reference example)

| Test Case | Input | Expected Result |
|---|---|---|
| Release, vector F | Contract in `PenaltyCalculated` from vector F | Net payment **2,326,000**; state `5`; event carries the amount |
| Release, vector A | Contract from vector A | Net payment **2,500,000** |
| Release, vector H | Contract from vector H | Net payment **0**; no revert |
| Release too early | Contract still in `Delivered` (deductions not yet calculated) or earlier | Reverts with "invalid state" |
| Double release | Already-released contract, release called again | Reverts — no double payout |
| Close | Released contract, `closeContract` called | State `6`; closed event emitted |
| Action after close | Closed contract, any state-changing call | Reverts |
| Full walk-through | create → book → dispatch → arrive → deliver late → release → close | History shows exactly these events, in this order; final net payment is 2,326,000 |

**Edge Cases**
- Attempting to close a contract that was never released — must be rejected, same as "release too early" above.
- A contract whose penalty and demurrage are both exactly equal to the freight value — net payment is exactly `0`; confirm this does not cause an arithmetic error.

**Acceptance Criteria**
- [ ] SRS §8.3's third acceptance criterion ("simulating a late delivery correctly produces a non-zero penalty/demurrage and a reduced net payment") passes as an automated test.
- [ ] No sequence of calls, however ordered or repeated, can produce two payouts for the same contract.

---

### Phase 14 — Dispute Resolution, Audit Interface and Portability

**Objective.** Handle real-world disputes — wagons held by the consignee, disagreement over delay causes — by pausing automatic settlement, letting an authorized person resolve the disagreement, and keeping all history immutable: a resolution is a new event, never an edit to an old one.

**Prerequisites.** Phase 13.

**Requirements Covered.** FR-B7 ("support a dispute state that pauses automatic settlement and allows an authorized user to resolve the dispute"); FR-B8 (complete); FR-B9 (complete); the Auditability and Portability NFRs.

**Implementation Tasks**
- `raiseDispute(contractId, reasonCode, raisedBy)`: callable by a party to the contract, moves state to `Disputed`, and blocks automatic settlement while disputed.
- `resolveDispute(contractId, outcome)`: callable only by an authorized arbitrator/admin role, sets the (possibly adjusted) deductions, and returns the contract to `PenaltyCalculated`.
- Confirm the read interface (`getContractStatus`) returns the complete history including dispute events, in order, with nothing overwritten.
- Deploy the finished contract to a second network (a second local instance at minimum; a public testnet if available) using only configuration changes, to prove the Portability NFR.

**Decisions to Confirm.** The arbitrator role mechanism (a fixed admin address is sufficient for a prototype; a full role-based system is optional); which states permit a dispute to be raised (recommended: after delivery, before payment release); the fixed set of resolution outcomes.

**Recommended outcomes** (reference example, vector F: penalty 150,000, demurrage 24,000):

| Outcome | Penalty after | Demurrage after | Net payment |
|---|---|---|---|
| `UpholdDeductions` | 150,000 | 24,000 | 2,326,000 |
| `WaivePenalty` | 0 | 24,000 | 2,476,000 |
| `WaiveAll` | 0 | 0 | 2,500,000 |

**Expected Input / Output.** Input: a contract ID and a reason (to raise), or a contract ID and an outcome (to resolve). Output: state transitions to `Disputed` and back to `PenaltyCalculated`; the stored deductions and the history reflect the dispute and its resolution.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Raise dispute | Vector F contract in `PenaltyCalculated`, shipper raises a dispute | State `7`; dispute event emitted |
| Settlement blocked | Disputed contract | `releasePayment` reverts |
| Unauthorized resolution | Disputed contract, carrier attempts to resolve | Reverts with "not the arbitrator" |
| Resolve with waiver | Disputed contract, arbitrator resolves `WaivePenalty` | State `4`; resolution event emitted; recalculated net payment is 2,476,000 |
| Release after resolution | Following the above | Net payment **2,476,000** |
| Dispute after release | Already-`PaymentReleased` contract, raise dispute | Reverts |
| Unauthorized dispute | A non-party account raises a dispute | Reverts |
| History integrity | A contract with a dispute in its history | Both the original penalty event and the resolution event are present; nothing has been overwritten |
| Portability | The full test suite | Passes identically against a second, freshly started local network |

**Edge Cases**
- A dispute raised, then resolved with `UpholdDeductions` — confirm the net payment is unchanged from the pre-dispute calculation.
- Two disputes raised in sequence on the same contract (raise, resolve, raise again) — decide and test whether this is allowed.
- An arbitrator account that is also the carrier or shipper on the same contract — decide and document whether this is prevented or simply unlikely in practice.

**Acceptance Criteria**
- [ ] All three outcomes produce the net payments shown in the table.
- [ ] Dispute history remains intact and queryable.
- [ ] The full contract test suite passes against a second network using configuration changes only — this is the evidence for the Portability NFR.
- [ ] Track 2 is considered feature-complete: it can be deployed and tested entirely on its own, with no dependency on Track 1 or Track 3.

---

# Track 3 — Platform (Backend API + Dashboard)

Owner: the member responsible for both the backend API and the web dashboard. Requirements: FR-D1 – FR-D3, and the backend/frontend half of every FR-A and FR-C requirement (Technical Design §5.1, §6.1). The backend is the only thing the dashboard talks to, and it never lets Track 1 and Track 2 talk to each other.

Until Track 1 and Track 2 are ready, build against the **Phase 2 stubs**; swap to the real services without changing the backend's own interface.

---

### Phase 15 — Backend Foundation: Persistence and Migrations

**Objective.** Establish the database schema, through versioned migrations, that every later Track 3 phase builds on.

**Prerequisites.** Phase 1.

**Requirements Covered.** Technical Design §8.1 (storage split and data ownership).

**Implementation Tasks**
- Create the schema through versioned, automatically-applied migrations: users, orders, wagons, routes, optimizer runs, allocation plans, and a contract cache (contracts, delivery events, penalty/demurrage, payments), plus an audit trail table.
- Link plan → run, and contract → plan → orders, so the chain of responsibility is traceable (satisfies FR-A8's traceability from the backend's side).
- A seed step for master data (wagons, routes — reuse Track 1's Phase 3 generator output as a convenient source) and demo users for each role.

**Decisions to Confirm.** The migration tool; whether the backend also persists a linked copy of Track 1's run metadata or relies on the Track 1 log for optimizer diagnostics; the seed data source.

**Expected Input / Output.** Input: an empty database. Output: a fully migrated schema, with seed data present, reproducible from a clean state with one command.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Fresh migration | Empty database, start the app | All migrations apply; every table exists |
| Idempotent migration | Already-migrated database, start again | No change, no error |
| Constraint enforcement | Insert an order with negative quantity directly in SQL | Rejected by a database constraint |
| Referential integrity | Insert a plan referencing a non-existent run | Rejected by a foreign key constraint |
| Seed step | Run it | Four demo users (one per role), plus wagons and routes, are present |
| Seed idempotency | Run the seed step twice | No duplicate rows |
| Persistence | Restart the database and the app | Data survives the restart |

**Edge Cases**
- A migration applied out of order on one member's machine versus another's — the migration tool must prevent this, not merely warn about it.
- A seed step run against a database that already has real (non-seed) data — must not silently overwrite or duplicate it; decide and document the expected behaviour.

**Acceptance Criteria**
- [ ] Any member can wipe and rebuild their local database with one command.
- [ ] The schema is documented alongside the migrations (table purposes and key relationships).

---

### Phase 16 — Authentication, Authorization and Audit Trail

**Objective.** Establish who is calling before any other backend behaviour is built — security retrofitted later is security done badly.

**Prerequisites.** Phase 15.

**Requirements Covered.** FR-D1 ("require authentication before any order, contract, or settlement action"); FR-D2 ("enforce role-based access control"); FR-D3 ("maintain an audit trail of user actions that change system state").

**Implementation Tasks**
- A login endpoint that checks credentials against securely hashed passwords and returns a signed token carrying the user's role.
- Require a valid token on every endpoint except health and login.
- Enforce role-based authorization centrally, against the matrix in Appendix A — not scattered ad hoc across individual handlers.
- Write one audit-trail row for every state-changing call: who performed it, what it was, when, and its outcome.

**Decisions to Confirm.** The password hashing algorithm; token lifetime and refresh strategy; how a platform user maps to an on-chain account for the carrier-signed calls Track 2 expects (needed concretely in Phase 18, but the mapping mechanism is decided here).

**Expected Input / Output.** Input: login credentials, or a request carrying a bearer token. Output: a signed token on successful login; a `401`/`403` as appropriate on every protected endpoint when the caller is not entitled; one audit row per state-changing action.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Successful login | Correct seeded credentials | `200`; response includes a token and the user's role |
| Failed login | A wrong password | `401` with the standard error body |
| No token | Any protected endpoint, no `Authorization` header | `401` |
| Bad token | An expired, malformed, or wrongly-signed token | `401` |
| Role denied | `POST /orders` as Carrier | `403` |
| Role allowed | `POST /orders` as Shipper | Not `401`/`403` (may still be `400` until Phase 17 exists) |
| Read allowed, write denied | `GET /contracts` as Auditor, then `POST` as Auditor | `200` for the read; `403` for the write |
| Open endpoint | `GET /health`, no token | `200` (intentionally unauthenticated) |
| Audit row written | Any successful state-changing call | Exactly one new audit row, with the correct user, action, timestamp, and outcome |
| RBAC matrix, exhaustively | Every (role, action) pair in Appendix A | Behaviour matches the matrix exactly — implement as one data-driven test, not 40 hand-written ones |

**Edge Cases**
- A token valid in structure but for a user that has since been deleted or disabled — must be rejected, not silently trusted.
- A role name typo or unrecognized role in a token — must be treated as unauthorized, not as a default/fallback role.
- A password appearing anywhere in a log line or an error response — must never happen; add a specific test asserting this.

**Acceptance Criteria**
- [ ] The RBAC matrix is verified by one data-driven test covering every cell of Appendix A.
- [ ] No password, in any form, appears in logs or responses.
- [ ] Every state-changing endpoint produces exactly one audit row per call.

---

### Phase 17 — Order Intake and AI/ML Integration

**Objective.** Close the loop from a submitted order to an allocation plan, and ensure a slow or unreachable AI/ML engine never takes order intake down with it.

**Prerequisites.** Phase 16; Track 1 Phase 4 (or the Phase 2 stub, usable from the start).

**Requirements Covered.** FR-A1, FR-A2 (accepted from the Platform side); FR-A6 (relayed what-if requests); FR-A7 (export, from the Platform side); the Reliability NFR regarding Track 1 availability.

**Implementation Tasks**
- `submitFreightOrder`: validate, persist, return an order ID; field-level errors on bad input.
- Enforce order immutability once a plan has been generated from it (Technical Design §8.1) — further changes require a new order.
- `requestOptimizedPlan`: gather pending orders, master data, and the requested weights; call Track 1's `optimize` endpoint; persist the returned plan and its run ID; return it to the caller.
- Plan retrieval by ID, and export in at least one machine-readable format (CSV or JSON) for downstream hand-off.

**Decision.** Resolved by [decision 30](decisions.md): only `Pending` orders enter a new run, the default Track 1 timeout is 60 seconds, and saving the plan locks the included orders. No rejection/unlock action exists in the prototype; weight what-if runs reuse the immutable saved input snapshot and keep alternatives in one scenario group.

**Expected Input / Output.** Input: an order submission (cargo type, quantity, destination, priority, deadline), or a request to run optimization with a weights object. Output: an order ID; or an `AllocationPlan` with a plan ID and run ID, persisted and retrievable afterward.

**Test Cases** — build and pass these first against the Phase 2 stub, then re-run unchanged against the real Track 1 service:

| Test Case | Input | Expected Result |
|---|---|---|
| Valid order submission | A well-formed order | `201`; response includes the order ID |
| Invalid quantity | `quantity: -5` | `400`; error identifies the `quantity` field |
| Invalid priority | `priority: 9` | `400`; error identifies the `priority` field |
| Run optimization | Weights supplied, pending orders exist | `200`; a plan with a plan ID, run ID, and assignments; retrievable afterward by ID |
| Order immutability | An order already included in a plan, attempt to modify it | `409` |
| Weight validation first | Weights out of the valid range | `400` *before* Track 1 is called — confirm Track 1 receives no request in this case |
| Track 1 unreachable | Stop the AI/ML engine, then request optimization | `503` naming the AI/ML engine as the failed dependency; **order submission still returns `201`** |
| Track 1 times out | A response arrives after the configured timeout | `503`/`504`; no partial plan is persisted |
| Export as CSV | A completed plan, export requested | One row per assignment; the file opens correctly in a spreadsheet application |
| Export as JSON | A completed plan, export requested | Validates against the Phase 1 `AllocationPlan` schema |

**Edge Cases**
- No pending orders at all when optimization is requested — must return a clear, valid (empty) result rather than erroring.
- Track 1 returns a response that does not match the agreed schema (a contract violation on Track 1's side) — must be caught and surfaced as a clear `502`/`503`-style error, not passed through to the dashboard unvalidated.
- Two optimization requests submitted back-to-back before the first completes — behaviour must be defined and tested (recommended: both are allowed to run independently, each producing its own plan).

**Acceptance Criteria**
- [ ] Every test case passes against the stub, then again against the real Track 1 service, unchanged.
- [ ] Stopping the Track 1 container demonstrably leaves order submission working.

---

### Phase 18 — Blockchain Integration: Contract Lifecycle Relay

**Objective.** Connect an accepted plan to a real on-chain agreement, and relay every subsequent carrier action with the correct signing identity.

**Prerequisites.** Phase 17; Track 2 Phase 10 (or the Phase 2 stub for the first part of this phase).

**Requirements Covered.** FR-B1 – FR-B6 (from the Platform's relaying side); FR-C3 (backend support for "accept a plan and trigger creation of the corresponding smart contract"); FR-C6 (backend support for serving the penalty/demurrage breakdown).

**Implementation Tasks**
- Read the deployed contract's address and ABI from the file Track 2's deploy script produces.
- `acceptPlanAndCreateContract`: given a plan and commercial terms, store the full terms in the database, call `createAgreement` with the terms and a hash of the full terms, and store the returned contract ID and agreement hash.
- Relay `confirmBooking`, `updateShipmentStatus`, and `confirmDelivery`, each signed with the correct caller's identity per the mapping decided in Phase 16.
- Return the computed penalty, demurrage, and net payment from the delivery-confirmation response.
- Trigger `releasePayment` and `closeContract` as the final steps, storing the resulting payment reference.
- Make every one of these calls **idempotent**: retrying after a timeout must not double-create an agreement or double-apply settlement.

**Decisions to Confirm.** How identity mapping from Phase 16 concretely signs each call for the prototype (recommended: the backend holds demo keys for shipper and carrier accounts and signs with the correct one per authenticated user — document this explicitly as a prototype simplification, since Technical Design §10.1 ultimately wants the caller verified independently); how off-chain money values become the on-chain integer representation (units, rounding).

**Expected Input / Output.** Input: a plan ID and commercial terms (to accept); a contract ID and a status or delivery payload (to relay transit/delivery events). Output: a contract ID and state on accept; updated state and, on delivery, the computed penalty/demurrage/net breakdown.

**Test Cases** — reference example, vector F (13 hours late, 10 hours held):

| Test Case | Input | Expected Result |
|---|---|---|
| Accept plan | A plan with terms, as Shipper | `200`; contract ID returned; `GET /contracts/{id}` shows state `0` |
| Idempotent accept | The same accept request repeated | Same contract ID returned; only one agreement exists on-chain |
| Wrong role | Accept attempted as Carrier | `403` |
| Unknown plan | Accept attempted for a plan ID that does not exist | `404` |
| Confirm booking | Carrier confirms booking | State `1` |
| Wrong carrier | A different carrier attempts to confirm booking | `403` or `404` |
| Deliver late, vector F | Carrier confirms delivery per vector F | Response: penalty `150000`, demurrage `24000`, net `2326000` |
| Idempotent delivery | The same delivery confirmation retried after a simulated timeout | Settlement is not applied a second time |
| Terms hash integrity | After accepting a plan | The hash of the stored off-chain terms equals the hash stored on-chain |
| Track 2 unreachable | Stop the chain node, then accept a plan | `503` with a clear code; nothing half-created remains in the database |
| Chain-level rejection | The contract itself reverts (for example, invalid terms) | Mapped to a specific `400`/`409`, never a generic `500` |

**Edge Cases**
- Accepting a plan whose orders have since been modified or deleted (should not be possible per Phase 17's immutability rule, but confirm it is actually enforced here too).
- A delivery confirmation arriving for a contract already past `Delivered` (for example, already settled) — must be rejected with a clear state error, not silently accepted.
- The backend process restarting between sending a transaction and recording its result — must not lose track of whether the on-chain call succeeded (reconcile on startup, or design the flow to be safely re-checkable).

**Acceptance Criteria**
- [ ] The full vector-F sequence (accept → book → deliver late → see the breakdown) works through HTTP calls alone, first against the Phase 2 stub, then against the real Track 2 contract.
- [ ] No accept-plan or delivery-confirmation call can be made to create two agreements or apply settlement twice, even under retries.

---

### Phase 19 — Real-Time Sync: Event Cache, Push and Resilience

**Objective.** Make contract data fast to read and live to watch, while treating the blockchain as the only source of truth (Technical Design §8.1).

**Prerequisites.** Phase 18.

**Requirements Covered.** FR-C4 (backend support for contract list/detail), FR-C5 (backend support for live tracking), FR-C7 (backend support for alerts), FR-B9 (serving the read interface to the dashboard); the Reliability and Security NFRs.

**Implementation Tasks**
- Subscribe to (or poll) Track 2's events and keep the local contract/event cache in sync.
- Serve `GET /contracts` and `GET /contracts/{id}` from the cache for speed.
- Push new events to connected dashboard clients over WebSocket, filtered to what each connected user is entitled to see.
- When Track 2 is temporarily unreachable, **queue** state-changing calls and retry them rather than dropping them.
- Run a periodic reconciliation: if the cache and the ledger disagree, the ledger wins.
- Ensure commercial terms are never exposed to a user who is not a party to that contract (SRS Security NFR).

**Decisions to Confirm.** The polling interval, if polling is used instead of (or alongside) event subscription; the reconciliation frequency; how a queued action is surfaced to the user while pending (if at all).

**Expected Input / Output.** Input: on-chain events, and dashboard read/subscribe requests. Output: a cache that reflects the chain within the polling/subscription interval; WebSocket messages delivered only to entitled clients.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Cache sync | Booking confirmed directly on-chain (bypassing the API) | Within the sync interval, the detail endpoint reflects state `1`, and a connected WebSocket client receives the event |
| Reads survive chain outage | Chain node stopped, `GET /contracts` called | Still `200`, served from cache |
| Writes queue, not drop | Chain node stopped, carrier confirms delivery | Accepted as queued; once the node returns, the delivery is applied exactly once |
| Reconciliation | A cache row deliberately corrupted, reconciliation runs | The row is corrected to match the ledger |
| Access isolation, shipper | Shipper B's token used to read Shipper A's contract | `404` |
| Access isolation, carrier | A carrier not assigned to the contract reads it | `404` |
| Auditor visibility | Auditor lists contracts | Sees all contracts, no write access |
| Push isolation | Two WebSocket clients (Shipper A, Shipper B), an event occurs on A's contract | Only A's client is notified |
| Load | 50 sequential summary requests | 95th-percentile response time under the target in §9 |
| Oversized payload | A deliberately very large order submission payload | Rejected cleanly; never reaches Track 1 |

**Edge Cases**
- The chain emits an event for a contract the cache has never seen (for example, after a cache reset) — reconciliation must be able to rebuild from scratch, not just patch incrementally.
- A WebSocket client that disconnects mid-stream — must not leak a connection or crash the push mechanism for other clients.
- Two reconciliation runs overlapping (if triggered too frequently) — must not double-apply corrections or race against each other.

**Acceptance Criteria**
- [ ] Stopping and restarting the chain node mid-session loses no state-changing action.
- [ ] Cross-shipper and cross-carrier visibility isolation is proven by automated tests.
- [ ] Track 3's backend is now feature-complete as an API: every endpoint from §8 exists and behaves per its tests.

---

### Phase 20 — Dashboard Foundation and Shared Components

**Objective.** Set up the dashboard project and the plumbing every screen will reuse, so each later screen phase is only about its own content.

**Prerequisites.** Phase 16 (for a real login to build against); a mock API serving Phase 1's sample payloads is sufficient to start, independent of Phases 17–19 being finished.

**Requirements Covered.** FR-D1, FR-D2 (frontend side); FR-C8 ("provide role-appropriate views: Shipper, Carrier, Administrator, Auditor").

**Implementation Tasks**
- Create the dashboard project with routing, a styling approach, and test tooling.
- A mock API layer serving the Phase 1 sample payloads, switchable to the real backend with a single configuration change.
- A login screen; store the token deliberately (decide where); attach it to every request.
- One typed API layer, with one place that understands the backend's error body shape.
- Global handling: a `401` response returns the user to login; a `503` response shows a clear "service unavailable" state rather than a blank screen.
- A degraded-service banner driven by the backend's health endpoint.
- Navigation and visible actions derived from the role embedded in the token (the server still enforces; the UI only decides what to show).
- Reusable loading, empty, and error-state components used by every screen built afterward.

**Expected Input / Output.** Input: user credentials, or an existing token. Output: an authenticated session with role-appropriate navigation; a consistent way to show loading/empty/error states across the app.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Logged out | Open the app with no session | Redirected to login |
| Carrier login | Log in as Carrier | Navigation shows only the screens Carrier is entitled to; navigating directly to a disallowed screen's URL redirects away |
| Auditor login | Log in as Auditor | Same screens as Carrier; no action buttons appear anywhere |
| Session expiry | A request returns `401` mid-session | User is returned to login with an explanatory message |
| Track 1 or Track 2 down | The backend reports a dependency as down | A banner appears; unaffected screens continue to work |
| Backend down | The backend itself is unreachable | A full-page "cannot reach server" state, never a blank page |
| Type-checking / build | Run the project's build | Completes with no type errors |
| Reload mid-session | Reload the page while logged in | Session behaviour (persist or require re-login) is consistent every time |
| Mock-to-real switch | Flip the configuration setting | The entire app now talks to the real backend, with no code change |

**Edge Cases**
- A token that is technically valid but for a role no longer recognized by the frontend's role table — must fail safely (no screens shown, or redirected to login), not crash the app.
- A very slow backend response — the loading state must appear and not hang indefinitely without feedback.

**Acceptance Criteria**
- [ ] All four roles log in and see exactly the screens they are entitled to.
- [ ] Loading, empty, and error states exist as reusable components, used consistently.

---

### Phase 21 — Overview Screen

**Objective.** Build the first screen a planner sees, answering "is anything wrong right now?" at a glance.

**Prerequisites.** Phase 20; live data additionally needs Phase 19 (mock data is sufficient until then).

**Requirements Covered.** FR-C1 ("display a summary overview … on a home screen"); FR-C5 (map component); FR-C7 (alert list, partial).

**Implementation Tasks**
- A KPI row: active orders, wagon utilization, active contracts, pending payments.
- A map showing shipments currently in progress.
- A summary of today's allocation activity.
- An alert list surfacing recent SLA breaches, delays, and disputes.
- A utilization trend chart.

**Decisions.** Resolved in [decision 25](decisions.md): UTC defines today; the overview uses a tile-free SVG lifecycle schematic and an always-available shipment list; alerts are bounded to five items and overview refreshes every 15 seconds.

**Expected Input / Output.** Input: the backend's summary and contract-list endpoints. Output: a rendered overview with live or mock KPIs, map, and alerts.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Normal load | Summary endpoint responds | KPIs visible within the performance target from §9 |
| Summary failure | Summary endpoint errors | An error state appears in that panel only; the rest of the screen remains usable |
| No data yet | Zero orders exist | A clear empty state, with a link to the Run Optimization screen |
| Live alert | A contract enters a dispute or becomes late | A new alert appears within one 15-second refresh interval |
| Small viewport | 375px-wide viewport | No horizontal overflow; KPIs stack vertically |
| Mock data indicator | The mock API is in use | The screen clearly indicates the data is sample data |

**Edge Cases**
- A very large number of active alerts — the list must be bounded or paginated, not render unbounded DOM elements.
- The schematic is rendered locally and needs no map tiles; the shipment list remains available as a text alternative.

**Acceptance Criteria**
- [x] Loading, populated, empty, and error states all look intentional, not accidental.
- [x] Keyboard navigation order is sensible, and focus is visibly indicated throughout.

---

### Phase 22 — Run Optimization Screen

**Objective.** Build the centrepiece interaction: adjusting weights and seeing a visibly different allocation plan.

**Prerequisites.** Phase 20; live data additionally needs Phase 17.

**Requirements Covered.** FR-A4, FR-A5, FR-A6 (frontend side); FR-C2 ("allow a user to configure optimization parameters and trigger a new optimization run, and shall display the resulting plan"); FR-C3 ("allow a user to accept a plan and trigger creation of the corresponding smart contract").

**Implementation Tasks**
- A parameter form with the three weight controls (on-time, cost, utilization), showing the normalized shares live.
- A Run action with visible progress, protected against double-submission, and tolerant of a slow response.
- A result view: the assignment table, KPI cards (utilization, cost, distance, on-time probability), the unassigned-orders list with human-readable reasons, and the ranked alternatives.
- A what-if flow: re-run with different weights and compare the new result against the previous one.
- An Accept action that creates the contract and takes the user to it.

**Expected Input / Output.** Input: weight values and a Run action; subsequently, an Accept action on a displayed plan. Output: a rendered plan with metrics; on accept, navigation to the new contract's detail view.

**Decisions.** Resolved in [decision 26](decisions.md): show normalized shares from the three dials, retain each run as a separate plan, compare cost and on-time probability, keep order entry available during optimizer outages, and use the existing idempotent accept endpoint with plan-derived wagon count.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| First run | Weights `(1,0,0)`, Run | Plan renders; displayed KPIs match the API response exactly |
| What-if | Change weights to `(0,1,0)`, Run again | A new plan renders; a comparison shows the change in cost and on-time metrics |
| Double-click protection | Click Run twice in rapid succession | Only one request is sent |
| Track 1 unavailable | The AI/ML engine is down | A message names the dependency as the problem, and states that orders can still be submitted |
| Unassigned orders shown | A plan with unassigned orders | Listed with human-readable reasons, not raw internal reason codes |
| Accept plan | Click Accept on a displayed plan | A loading state is shown; on success the user lands on the new contract's detail view; on failure the plan remains visible with a clear error |
| Role restriction | Logged in as Carrier or Auditor | This screen is not reachable |
| Invalid weights | All weights set to zero | The UI either prevents this or clearly explains the resulting behaviour |

**Edge Cases**
- A run that takes close to the full performance-target time — the UI must show ongoing progress, not appear frozen.
- A plan with zero assignments (everything unassigned) — must render a meaningful result, not an empty or broken screen.
- Accept clicked twice in quick succession — must not create two contracts (this should already be prevented at the backend per Phase 18, but the UI should also disable the control after the first click).

**Acceptance Criteria**
- [ ] The full flow — submit an order, run, what-if, accept — is visually verified end to end against the real backend, Track 1, and configured Track 2 signer.
- [x] Two clearly different weightings produce visibly different results in the interactive demo.

---

### Phase 23 — Contracts Screen

**Objective.** Make the blockchain layer visible: the state progression and the immutable event log are the concrete evidence, for anyone evaluating the system, that the smart contract is actually doing something.

**Prerequisites.** Phase 20; live data additionally needs Phases 18–19.

**Requirements Covered.** FR-B2, FR-B7, FR-B8, FR-B9 (frontend side); FR-C4 ("display a list of contracts with current state, and a detail view with terms, state history, and on-chain event log"); FR-C8 (role-appropriate actions).

**Implementation Tasks**
- A searchable, filterable list of contracts, showing current state.
- A detail view: terms, a visual progress indicator across every lifecycle state, and the full event log with timestamp and actor.
- Actions shown according to the current user's role and the contract's current state (confirm booking, raise dispute, and so on).

**Expected Input / Output.** Input: list filters/search terms; a selected contract ID. Output: a filtered list; a detail view with terms, state, and history.

**Decisions.** Resolved in [decision 27](decisions.md): role-scoped cursor-paged contracts, client-side free-text narrowing within loaded pages, full lifecycle and dispute path, chronological event metadata for all roles, party-only commercial detail, and action gates matching the backend role/state rules.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| List filtering | 20+ contracts, filter by state and by free-text search | The list narrows correctly for both |
| Detail view | Open any contract | Terms are shown; the current state is highlighted in the progress indicator; log entries are in chronological order |
| Disputed state | A contract in state `Disputed` | Visually distinguished from the normal lifecycle path |
| Shipper actions | Logged in as Shipper, viewing own contract | Sees a Raise Dispute action where the state allows it |
| Carrier actions | Logged in as Carrier, viewing an assigned contract in state `Created` | Sees a Confirm Booking action; does not see it once the state has advanced |
| Auditor restriction | Logged in as Auditor | No action buttons appear anywhere, on any contract |
| Redacted audit history | Logged in as Administrator or Auditor | Lifecycle state and event metadata are visible; terms, assignments, and financial values remain hidden |
| Successful action | Perform an available action | A progress indicator is shown; on success the state and log update without a page reload |
| Rejected action | An action rejected by the backend (`409`) | The reason is shown to the user; the displayed state is unchanged |

**Edge Cases**
- A contract with a very long event history — the log view must remain usable (scrollable or paginated), not degrade the page.
- A role viewing a contract that exists but that they are not entitled to see — the detail view must show a clear "not found" state, consistent with the backend's `404`-for-ownership behaviour, not a broken page.

**Acceptance Criteria**
- [x] Every action button appears only for the exact (role, state) combinations the backend would accept — verified against Appendix A.
- [x] The log shown on screen matches the chain's own log for the same contract, field for field through the backend event cache.

---

### Phase 24 — Tracking and Settlement Screen

**Objective.** Tell the money story clearly: what happened during transit, whether the SLA was met, and exactly how the final payment was computed.

**Prerequisites.** Phase 23; live, meaningful numbers additionally need Track 2 Phases 12–13 and Platform Phase 18.

**Requirements Covered.** FR-B3, FR-B4, FR-B5, FR-B6 (frontend side); FR-C5 ("display live/periodic shipment tracking information"); FR-C6 ("display computed penalty/demurrage breakdowns and net settlement amounts").

**Implementation Tasks**
- For one selected contract: a route-progress and milestone timeline; an ETA-versus-SLA indicator.
- The carrier's forms for posting status updates and confirming delivery (with a proof-of-delivery reference).
- A settlement breakdown: freight value, penalty (with the block count and rate shown), demurrage (with wagons, hours, and rate shown), and the resulting net payable.
- Display exactly what the backend returns for all monetary figures — never recompute money in the browser.

**Expected Input / Output.** Input: a selected contract; for the carrier, a status or delivery submission. Output: a rendered timeline and, once available, a settlement breakdown.

**Test Cases** — reference example, vector F (13 hours late, 10 hours held):

| Test Case | Input | Expected Result |
|---|---|---|
| Late delivery breakdown | A contract delivered per vector F | Breakdown reads: freight 2,500,000 − penalty 150,000 (3 blocks × 2%) − demurrage 24,000 (12 wagons × 4 h × 500) = net **2,326,000** |
| Numeric fidelity | Same contract | The numbers shown match the API/chain values exactly, digit for digit |
| On-time delivery | A contract delivered on time | Zero deductions shown, with a clear "SLA met" indicator |
| At-risk indicator | A contract still in transit, with ETA past the SLA | An at-risk indicator is shown before delivery actually occurs |
| Incomplete submission | Carrier submits delivery with an empty proof-of-delivery reference | Submission is blocked with a clear message |
| Live update | Carrier submits delivery | The timeline and breakdown update without a page reload |
| Role restriction | Logged in as Shipper or Auditor | No status-update or delivery form is shown |
| Disputed state | A contract currently disputed | The breakdown shows an "on hold" state instead of a final figure |

**Edge Cases**
- A contract with zero penalty but non-zero demurrage, or vice versa — the breakdown must show both lines correctly even when one is zero, not hide a zero line in a way that looks like missing data.
- A very large penalty due to extreme lateness (approaching or hitting the cap from Phase 12) — the breakdown must clearly indicate the cap was applied, not just show a number that silently looks wrong.

**Acceptance Criteria**
- [x] The vector-F breakdown renders exactly as specified above in the contract screen test; live contract confirmation remains dependent on the configured local database and chain.
- [x] Colour is never the only signal distinguishing on-time from late, or settled from disputed; state and hold status are also stated in text.

---

### Phase 25 — Alerts, Export and UI Polish

**Objective.** Close the gap between "the features work" and "this is a convincing, usable prototype."

**Prerequisites.** Phases 21–24.

**Requirements Covered.** FR-C7 ("raise in-app alerts for SLA breaches, delays, and disputes" — completed); FR-C9 ("allow export of plans and settlement records"); the Usability and Performance NFRs.

**Implementation Tasks**
- Real-time in-app alerts for SLA breaches, delays, and disputes, delivered via the push mechanism from Phase 19.
- CSV export of plans and of settlement records.
- Responsive layout verification across the screens built in Phases 21–24.
- Consistent copy/wording, and accessibility basics (keyboard operability, non-colour-only signalling, reasonable contrast).
- Address anything noted but deferred while building Phases 21–24.

**Expected Input / Output.** Input: a live event stream; an export request. Output: timely alerts; a downloadable file matching what is shown on screen.

**Test Cases**

| Test Case | Input | Expected Result |
|---|---|---|
| Live alert delivery | A delivery is confirmed late while another user is actively watching the app | An alert appears within a few seconds, with no manual refresh |
| Plan export | Export a plan | The downloaded file opens correctly and its row/column counts match what the screen shows |
| Settlement export | Export a settlement record | Same check as above, for settlement data |
| Responsive check | Viewport widths 375px, 768px, 1280px | No horizontal scrolling on any of the four screens |
| Keyboard-only operation | Attempt the full flow (login → run optimization → accept → open a contract) using only the keyboard | Fully achievable |
| Slow network | Network throttled to a slow connection profile | Loading states are shown; no jarring layout shifts as data arrives |
| Automated accessibility scan | Run against each of the four screens | No critical violations reported |

**Edge Cases**
- An alert for a contract the current user is not entitled to see arriving on the push channel (should already be prevented server-side per Phase 19, but add a client-side check as defence in depth).
- An export requested while the underlying data is still loading — must wait or clearly indicate it cannot export yet, not export incomplete or stale data.

**Acceptance Criteria**
- [ ] A person who has not seen the application before can complete an order-to-plan flow after only a short walkthrough, satisfying the SRS Usability NFR.
- [ ] Track 3 is considered feature-complete across both the backend API and the dashboard.
- [x] Authenticated dashboard clients receive party-only live contract events, recover from a dropped connection, and refresh the affected view; alerts name disputes, late settlement, and shipment risk in text.
- [x] Plan and settlement CSV actions export only loaded data; automated tests cover CSV encoding, formula safety, exact paise values, and event classification.
- [ ] Visually verify the overview, allocations, contracts, and tracking screens at 375px, 768px, and 1280px, including keyboard and accessibility review.
- [ ] Complete the order-to-plan walkthrough with someone unfamiliar with the application.

---

# Integration (Phases 26–27)

---

### Phase 26 — End-to-End Flow Validation

**Objective.** Prove all three tracks work together correctly, in one automated, repeatable run, starting from nothing.

**Prerequisites.** All phases above.

**Requirements Covered.** Technical Design §9 (end-to-end sequence); indirectly, every FR exercised along the way.

**Implementation Tasks**
- Automate the full order-to-settlement sequence as a script (or an end-to-end UI test), asserting state and numbers after every step.
- Run it against a freshly built system: an empty database and a freshly deployed contract, with no manual setup steps beyond what the README documents.
- Include deliberate failure drills that interrupt the flow partway through, to verify the resilience behaviour built in Phases 17–19.

**Expected Input / Output.** Input: `docker compose up --build` from a clean checkout. Output: a passing automated run of the full sequence below, plus passing failure drills.

**Test Cases** — the late-delivery scenario (vector F):

| # | Step | Actor | Expected Result |
|---|---|---|---|
| 1 | Submit order | Shipper | Order stored; `201` |
| 2 | Run optimization | Shipper | Plan with metrics returned; order locked |
| 3 | Accept plan with the reference-example terms | Shipper | Contract created; state `0`; terms hash matches on-chain |
| 4 | Confirm booking | Carrier | State `1` |
| 5 | Post `Dispatched` | Carrier | State `2` |
| 6 | Post `ArrivedAtDestination` | Carrier | Still state `2`; history grows |
| 7 | Confirm delivery, 13 hours after the SLA, 10 hours held | Carrier | State `4`; penalty 150,000; demurrage 24,000 |
| 8 | Release payment | Backend | State `5`; net 2,326,000; payment reference stored |
| 9 | Close | Backend | State `6`; further changes rejected |
| 10 | Read the event log | Auditor | Every event, in order, matching the chain |
| 11 | Open the contract in the dashboard | Shipper | Every step above is visible; the settlement breakdown matches step 8 |

Repeat the same sequence with an **on-time** delivery: penalty 0, demurrage 0, net 2,500,000.

**Failure drills**

| Drill | Expected Result |
|---|---|
| Stop the AI/ML engine before step 2 | Step 2 returns `503`; step 1 (order intake) still succeeds |
| Stop the chain node before step 7, then restart it | The delivery confirmation is queued and applied exactly once after the node returns |
| Repeat step 3 | The same contract ID is returned; no second agreement is created |
| Repeat step 8 | Rejected; no double payout occurs |

**Edge Cases**
- The script run twice in a row without resetting state — must either be idempotent or clearly document that a reset is required between runs.
- A step that times out due to an unusually slow machine — the script's own timeouts must be generous enough not to produce false failures, while still catching a genuinely broken step.

**Acceptance Criteria**
- [ ] The script passes from a completely clean `docker compose down -v && up --build`.
- [ ] All four failure drills pass.
- [ ] Both the late and the on-time scenarios produce the exact figures stated above.

---

### Phase 27 — Acceptance Testing and Final Validation

**Objective.** Confirm the system meets every acceptance criterion stated in the SRS, and that it can be presented to someone unfamiliar with the project without surprises.

**Prerequisites.** Phase 26.

**Requirements Covered.** SRS §8.3 (acceptance criteria).

**Implementation Tasks**
- Walk through each SRS acceptance criterion and collect its evidence (an automated test result, a saved output, or a screen recording).
- Rehearse a short demonstration covering the full order-to-settlement flow across all three tracks.
- Confirm the system can be reset to a known starting state with a single command, so it can be demonstrated repeatedly.

**Expected Input / Output.** Input: a running system on a machine other than the one it was built on. Output: a completed acceptance checklist with evidence for every criterion, and a repeatable demo.

**Test Cases** (SRS §8.3)

| Criterion | Evidence Required |
|---|---|
| A synthetic order set produces a plan with computed utilization, cost and on-time metrics (FR-A3, FR-A5) | Track 1 Phases 6–8 test results, plus a recording of the Run Optimization screen |
| An accepted plan produces a corresponding on-chain contract with correctly captured terms (FR-B1) | Track 3 Phase 18 test result, plus the terms-hash match |
| Simulating a late delivery correctly produces a non-zero penalty/demurrage and a reduced net payment (FR-B5, FR-B6) | Track 2 Phase 13 test result, plus the Phase 26 end-to-end run |
| All four dashboard screens are navigable across the full order-to-settlement flow | The Phase 26 dashboard step, recorded as a screen capture |

**Demonstration outline** (no fixed timing — sequence only):

1. Overview screen with all three tracks healthy.
2. Run optimization twice with different weights; point out the change in results.
3. Accept the plan; open the resulting contract; show its terms and state progress.
4. As Carrier: confirm booking, post transit status, confirm a late delivery.
5. As Shipper: show the settlement breakdown matching the reference example.
6. As Auditor: show the immutable event log, and that no action buttons are available.
7. Stop the AI/ML engine: show the degraded-service banner while order submission still works.

**Edge Cases**
- The demonstration machine has none of the development tools installed beyond Docker — the system must still run from the documented single command.
- A question during the demonstration about a dropped order, a rejected input, or a disputed contract — the system should be able to show that case live, not only the happy path.

**Acceptance Criteria**
- [ ] The system runs from one documented command on a machine that is not any team member's own development machine.
- [ ] A reset command returns the system to a known, demonstrable state.
- [ ] Every acceptance criterion in the table above has recorded evidence.
- [ ] Every "Acceptance Criteria" checklist in Phases 0–26 is fully checked.

---

## 14. Final Validation

Before the project is considered complete, confirm all of the following, cutting across every track:

| Area | Validation |
|---|---|
| Architecture | The dependency rules in §2/§5 are not violated anywhere in the final codebase (no track calls another track it should not). |
| Functional coverage | Every requirement in Appendix B has at least one phase marked complete, and its "Must" items (per the SRS priority tags) all have passing tests. |
| Performance | The measured figures from §9 are recorded and meet their targets. |
| Error handling | Every row in §10's table has at least one passing automated test. |
| Security | FR-D1/FR-D2/FR-D3 are enforced centrally and tested exhaustively (Phase 16); commercial terms are never exposed across unauthorized roles (Phase 19). |
| Reliability | Both failure drills in Phase 26 pass; the degraded-service banner is demonstrated live. |
| Auditability | A full, unbroken event history is retrievable for at least one contract that went through a dispute (Phase 14) and one that did not. |
| Portability | Track 2's test suite passes unmodified against a second network (Phase 14). |
| Usability | The Phase 25/27 walkthrough criterion has been actually tried with someone unfamiliar with the system. |
| Demo readiness | The system starts from one command, resets from one command, and the Phase 27 demonstration outline has been rehearsed at least once in full. |

---

## 15. Appendices

### Appendix A — RBAC Matrix

✓ allowed (the resource must belong to the caller, or the caller must be assigned to it) · ✗ forbidden (`403`).

| Action | Shipper | Carrier | Administrator | Auditor |
|---|---|---|---|---|
| Log in | ✓ | ✓ | ✓ | ✓ |
| `POST /orders` | ✓ | ✗ | ✓ | ✗ |
| `POST /optimizations/run` | ✓ | ✗ | ✓ | ✗ |
| `POST /plans/{id}/accept` | ✓ | ✗ | ✓ | ✗ |
| `GET /dashboard/summary` | ✓ | ✗ | ✓ | ✗ |
| `GET /contracts`, `GET /contracts/{id}` | own | assigned | all | all (read-only) |
| Confirm booking | ✗ | ✓ (assigned) | ✗ | ✗ |
| Post shipment status | ✗ | ✓ (assigned) | ✗ | ✗ |
| Confirm delivery | ✗ | ✓ (assigned) | ✗ | ✗ |
| Raise dispute | ✓ (own) | ✓ (assigned) | ✓ | ✗ |
| Resolve dispute | ✗ | ✗ | ✓ | ✗ |
| Manage users, wagons, routes | ✗ | ✗ | ✓ | ✗ |
| View audit trail | ✗ | ✗ | ✓ | ✓ |

### Appendix B — Requirement Coverage

| Requirement | Priority (SRS) | Phase(s) |
|---|---|---|
| FR-A1 Accept freight orders | Must | 3, 17 |
| FR-A2 Accept wagon and route master data | Must | 3, 15 |
| FR-A3 Generate an allocation plan under constraints | Must | 4, 6 |
| FR-A4 Rank orders by configurable weights | Must | 5, 6 |
| FR-A5 Report utilization, cost, distance, on-time probability | Should | 5, 7, 8 |
| FR-A6 What-if re-runs | Should | 5, 22 |
| FR-A7 Export an accepted plan | Must | 4, 17 |
| FR-A8 Log every optimization run | Could | 8 |
| FR-B1 Create an agreement from a plan | Must | 10, 18 |
| FR-B2 Carrier confirms booking | Must | 10, 18 |
| FR-B3 Record status transitions | Must | 11, 18 |
| FR-B4 Delivery confirmation with proof | Must | 12, 18 |
| FR-B5 Evaluate SLA, compute penalty/demurrage | Must | 12 |
| FR-B6 Automatic payment release, net of deductions | Must | 13, 18 |
| FR-B7 Dispute state | Should | 14 |
| FR-B8 Immutable event log | Must | 10, 11, 14 |
| FR-B9 Read interface for state and terms | Must | 10, 19 |
| FR-C1 Overview | Must | 21 |
| FR-C2 Configure and run optimization | Must | 22 |
| FR-C3 Accept plan, create contract | Must | 22 |
| FR-C4 Contract list and detail | Must | 23 |
| FR-C5 Live shipment tracking | Should | 21, 24 |
| FR-C6 Penalty/demurrage breakdown | Must | 24 |
| FR-C7 In-app alerts | Should | 21, 25 |
| FR-C8 Role-appropriate views | Must | 20, 23 |
| FR-C9 Export plans and settlement | Could | 25 |
| FR-D1 Authentication | Must | 16, 20 |
| FR-D2 Role-based access control | Must | 16, 20 |
| FR-D3 Audit trail of state-changing actions | Should | 16 |

### Appendix C — What to Cut First

If a track falls behind, cut in this order. Every "Must" requirement survives even after every cut below.

| Order | Cut | Requirement Affected | Effect |
|---|---|---|---|
| 1 | Settlement CSV export, richer export formats | FR-C9 (Could) | Keep plan export only |
| 2 | Optimizer run log detail | FR-A8 (Could) | Keep the plan's run ID as the minimum link |
| 3 | Live map, utilization trend chart | FR-C5, FR-C1 (partial) | Keep the milestone timeline as a list |
| 4 | Real-time push alerts | FR-C7 (Should) | Fall back to polling |
| 5 | Dispute resolution flow | FR-B7 (Should) | Keep the `Disputed` state defined in the enum; drop the UI/flow around it |
| 6 | The ML prediction component (Phase 7) | FR-A5 (Should, partially) | Keep the simpler on-time measure from Phase 5 |
| 7 | What-if comparison UI | FR-A6 (Should) | Keep the ability to re-run; drop the side-by-side comparison view |

### Appendix D — Where to Look When Something Breaks

| Symptom | Look At |
|---|---|
| Dashboard shows "cannot reach server" | Is the backend up? Then check its own health endpoint. |
| Backend health reports "degraded" | The specific dependency it names (Track 1 or Track 2). |
| A contract call reverts | The distinct error name: not authorized, invalid state, unknown contract, or invalid terms. |
| A computed penalty or demurrage figure looks wrong | Recompute by hand using the Phase 12 formulas; check block-boundary rounding first. |
| Cache and ledger disagree | The ledger is authoritative (Phase 19); trigger reconciliation. |
| The optimizer reports an unexpectedly low on-time probability | Check whether sample/test deadlines are still in the past; regenerate with current dates. |
| A port is already in use | Change the host side of the port mapping in Docker Compose. |

### Appendix E — Glossary

| Term | Meaning |
|---|---|
| Rake | A train formation of wagons moving together. |
| Wagon | An individual rail freight vehicle with a capacity measured in tonnes. |
| SLA | The agreed delivery deadline and conditions. |
| Demurrage | A charge for keeping wagons beyond an agreed free holding time. |
| POD | Proof of delivery — a reference to evidence that goods arrived. |
| Ledger | The blockchain record that is the source of truth for contract state. |
| Idempotent | Safe to repeat — performing an action twice has the same effect as performing it once. |
| Terms hash | A fingerprint of the full agreement terms, stored on-chain so the off-chain text can be independently verified. |
| Allocation agent | The decision-making algorithm (Track 1) that searches for a wagon/route assignment under constraints. |
| Learning component | The trained model (Track 1) that predicts a value — in this plan, on-time delivery probability — from historical or simulated data. |
