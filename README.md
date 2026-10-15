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

The full-system `docker compose up --build` workflow belongs to Phase 2; it is not available yet.

## Project layout

```text
ai-engine/          Track 1 — Python allocation service
blockchain/         Track 2 — Solidity contracts and deployment
backend/            Track 3 — TypeScript API
dashboard/          Track 3 — TypeScript web UI
samples/            Shared interface examples (Phase 1)
docs/
  contracts/        Cross-track contract drafts and schemas (Phase 1)
  decisions.md      Team decisions for the plan
  Plan.md           Full technical development plan
```

## Progress tracker

Update this table as work is completed. Set a phase to **In progress** only when someone has started it, and to **Done** only when its acceptance criteria in [the plan](docs/Plan.md) are met. Add a short link, test result, or commit in **Evidence / notes** so the other two members can verify progress.

### Foundation and team setup

| Phase | Work | Owner | Status | Evidence / notes |
|---|---|---|---|---|
| 0 | Toolchain and workspace setup | All three | In progress — Alim's local checks complete; team checks pending | Alim: Python 3.13.2, Node.js 22.22.3, npm 11.8.0, Docker 29.8.2 / Compose v5.6.0, Git 2.49.0; Python HTTP returned 200, Node hello-world ran, Docker hello-world passed, PostgreSQL 16 `SELECT 1` passed. Parth/Elish machine checks and shared clone/push verification remain. |
| 1 | Interface contracts and sample data freeze | All three | Done — all three approvals confirmed | [AI engine schema](docs/contracts/ai-engine.schema.json), [Platform OpenAPI](docs/contracts/platform.openapi.yaml), [Blockchain contract and ABI](docs/contracts/blockchain.md); [sample payloads](samples/). All three members' approvals recorded in [decision log](docs/decisions.md); schemas and examples validated. |
| 2 | Walking skeleton | All three | Not started | Start all services and verify degraded-service behavior with Docker Compose. |

### Track 1 — AI/ML Allocation Engine

| Phase | Work | Owner | Status | Evidence / notes |
|---|---|---|---|---|
| 3 | Synthetic data generation and input validation | Alim | Not started | |
| 4 | Rule-based allocation agent (baseline) | Alim | Not started | |
| 5 | Objective scoring, weighting, and ranking | Alim | Not started | |
| 6 | Optimization agent (constraint-based search) | Alim | Not started | |
| 7 | Machine-learning prediction component | Alim | Not started | |
| 8 | Traceability, logging, and performance validation | Alim | Not started | |

### Track 2 — Blockchain Settlement Layer

| Phase | Work | Owner | Status | Evidence / notes |
|---|---|---|---|---|
| 9 | Smart contract workspace and deployment pipeline | Parth | Not started | |
| 10 | Agreement creation and booking | Parth | Not started | |
| 11 | Transit status tracking and event log | Parth | Not started | |
| 12 | Delivery confirmation, SLA evaluation, penalty, and demurrage | Parth | Not started | |
| 13 | Settlement and contract closure | Parth | Not started | |
| 14 | Dispute resolution, audit interface, and portability | Parth | Not started | |

### Track 3 — Platform (Backend API + Dashboard)

| Phase | Work | Owner | Status | Evidence / notes |
|---|---|---|---|---|
| 15 | Backend foundation: persistence and migrations | Elish | Not started | |
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

The eight Phase 1 choices and their reasons are recorded in [docs/decisions.md](docs/decisions.md).

Phase 1 decisions and interface reviews are approved by Alim, Parth, and Elish; see the sign-off record in [docs/decisions.md](docs/decisions.md).
