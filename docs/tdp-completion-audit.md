# TDP completion audit — 26 October 2026

The implementation baseline is `docs/Plan.md` (requirements, detailed phase tasks, test cases and acceptance criteria), the Track 3 preparation checklist, API/schema contracts, the decision register and the README progress tables. The owner authorized autonomous decisions and completion across all tracks on 25–26 October. Earlier approval gates do not prevent this work; this does not record approval by other teammates or external acceptance participants.

## Requirement coverage

| TDP area | Implemented behavior and inspection evidence |
| --- | --- |
| FR-A1–A4: orders, master data, constraints and priorities | Persistent order intake/register; Administrator wagon/route editor with active/available flags; immutable saved input snapshots; capacity/type/route/deadline checks; priority-aware CP-SAT and greedy candidates; normalized objective weights. |
| FR-A5–A8: metrics, what-if, exports and trace | Plan metrics, saved-plan register and reopening, what-if comparison using saved snapshots, CSV/JSON API exports and dashboard CSV, linked run IDs and prediction/model metadata. The CP-SAT & ML lab runs the real services and presents frozen synthetic evaluation evidence with baseline and confusion matrix. |
| FR-B1–B4: agreement, booking, milestones, POD | Canonical hashed terms, party-linked agreement creation, explicit carrier booking, shipment milestones, proof of delivery and on-chain event history. |
| FR-B5–B9: deductions, release, disputes and ledger | Integer-paise penalty/demurrage with caps, accounting release and closure, dispute hold/resolution, role-filtered history and synchronization, queued outage recovery and idempotent retries. |
| FR-C1–C6: operational screens | Overview, order register, allocation workshop, saved plans, contract list/detail, shipment timeline and settlement breakdown, with role guards and loading/error/empty states. |
| FR-C7–C9: alerts, role access and exports | Party-only authenticated WebSocket notifications, reconnect/expiry handling, server-enforced role access and frontend guards; loaded-data CSV exports with exact paise and formula-safe encoding. |
| FR-D1–D3 and Appendix A | Password hashing, bounded JWT sessions, rate limiting, Shipper signup and role-specific single-use invitations; Administrator account controls and local signing-wallet provisioning; Administrator/Auditor action-audit page; Administrator wagon/route maintenance. |
| New owner request: blockchain demonstration | Live block window, animated hash-linked chain, real UTC timestamps and header roots, transaction hashes, block inspector, historical pagination, recorded-block replay, pause/reduced motion and local-only Administrator demonstration mining. |

## Gaps addressed in this completion pass

- `/audit` previously redirected to contracts. It now reads the action audit, with actor/action/outcome search and bounded pagination, without exposing request bodies or credentials.
- Saved plans had no discoverable register and disappeared from view after refresh. `/plans` lists accessible saved runs and reopens them in the allocation workshop.
- Administrator resource permissions existed without maintenance screens. Wagons and routes can now be added, edited and deactivated; existing saved plan snapshots stay unchanged.
- New freight accounts could not acquire a signing identity through the UI. An administrator can assign an unused unlocked account on development chain 31337; production and fixed-signer configurations reject automatic provisioning.
- Carrier selection required copying an address from outside the app. Active registered carriers now appear in the allocation workflow.
- Browser allocation requests timed out before the backend's solver budget. The request now has an explicit 70-second bound.
- Local EVM history previously disappeared when the node process stopped. The Compose node now uses pinned Anvil with a persistent state volume, periodic snapshots and historical-state preservation. Hardhat remains the Solidity compiler, deployer and test harness. Deployment reuses a compatible existing contract, checking bytecode with immutable fields normalized and verifying the operator.
- A clean validation run exposed empty process environment values masking generated secrets. The validation runner now sets its own generated environment explicitly and restores the prior process environment afterward.
- The backend now honors `AI_ENGINE_URL` for native runs as well as Compose runs.

## Evidence and limits

The authoritative run evidence is generated under ignored `artifacts/integration/` by `scripts/validate-integration.ps1`, `scripts/validate-acceptance.ps1` and `scripts/browser-acceptance.cjs`. The README and integration report record the final observed results. An implementation or test script by itself is not proof of a passing run.

The TDP additionally requires an unfamiliar-person walkthrough and execution on another machine. These need a real participant and another host; this machine cannot supply that evidence. They remain external acceptance items even when the automated software checks pass.

This remains a local academic prototype: synthetic ML evaluation is not production rail accuracy, the local EVM is not decentralized consensus, and INR settlement events do not move bank funds. The UI explains these boundaries in the relevant demonstrations.
