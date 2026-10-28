# Integration and final acceptance

The validation scripts use an isolated **chainroute-validation** Docker project with its own PostgreSQL, AI run-log and deployed-contract volumes. The ordinary development stack at ports 5173/8080/8000/8545/5432 is not reset. Validation ports are dashboard **15173**, backend **18080**, AI **18000**, chain **18545**, and PostgreSQL **15432**.

## Run or reset from one command

From a checkout on Windows with Docker Desktop running and PowerShell available:

```powershell
# Clean build, both settlement scenarios, service-outage drills, all test suites,
# production frontend build, and blockchain portability on a second local node.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-acceptance.ps1

# Run only the clean API integration scenario.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-integration.ps1

# Return only the validation project to a known, empty, seeded demo state.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-integration.ps1 -ResetOnly
```

Each integration invocation explicitly destroys and recreates **only the validation project's volumes**. Repeating it therefore has a documented clean-reset boundary. It generates local passwords and signing secrets automatically, applies every migration, seeds the four role accounts and master data, and deploys a fresh contract. No host Python, Node, PostgreSQL or Solidity installation is required. Image/dependency/compiler downloads require an internet connection on a cold machine. Linux/macOS execution of these PowerShell scripts has not been verified.

Open <http://localhost:15173> after the command finishes. The password for the validation stack's `demo.shipper`, `demo.carrier`, `demo.administrator`, and `demo.auditor` accounts is the **local ignored** `DEMO_USER_PASSWORD` in `artifacts/integration/.env.validation`. It differs from the main stack's root `.env` password. Never publish this file or `sessions.json`.

The integration run creates a late contract and an on-time contract; their IDs, plan IDs, run IDs, terms hashes, exact paise values, and public event evidence are in `artifacts/integration/report.json`. After a full successful run, both contracts are Closed. Reset before rehearsing their state transitions manually.

## What the automated integration proves

| Check | Assertion |
|---|---|
| Clean start | Empty order/contract tables, ordered migrations, automatic seed and deployment |
| AI outage | AI container stopped; health degraded, order intake 201, optimization 503, no partially saved plan |
| Optimization | Real Track 1 response, trained model metadata, metrics, locked order, retrievable AI trace |
| What-if | A second weighting reuses the saved order snapshot; no assertion that every input must produce a different allocation |
| Acceptance | Exact canonical 12-wagon terms; PostgreSQL/API/on-chain terms hashes match |
| Duplicate acceptance | Same key returns the same contract; one agreement exists on chain |
| Lifecycle | Created → Booked → InTransit; destination arrival preserves InTransit |
| Chain outage | The real node is paused; delivery returns 202 and is durably queued; cached reads work |
| Recovery | Resuming the node automatically completes the queued delivery exactly once |
| Late vector F | 13 hours late, 10 hours held; penalty 150,000, demurrage 24,000, net 2,326,000 paise |
| On-time scenario | Zero penalty and demurrage; net 2,500,000 paise |
| Dispute | Settlement blocked while disputed; administrator upholds deductions before release |
| Duplicate payment | Same key replays the original receipt; a new release key gets 409; one on-chain release |
| Closure | Closed in cache and chain; further mutation rejected; payment reference and closure stored |
| Audit | Every action and data hash matches ledger history; Auditor gets no private commercial fields |
| Replay repair | Deliberately corrupted shipment hash repaired without duplicate event rows |
| Read performance | 50 real contract-list HTTP requests meet the 500 ms p95 target |
| Frontend availability | Deep routes serve the SPA through the published localhost port |

Payment release is the prototype's on-chain **accounting event**, not a bank transfer. Commercial amounts are integer paise throughout.

The complete acceptance command also runs the AI tests, the PostgreSQL/live-AI/live-chain backend tests, dashboard tests and production build, and the unmodified blockchain suite on an independent second local node. Live dashboard component tests use actual HTTP responses for the settled contract, navigation, tracking/settlement, export availability and Auditor privacy. They run in Happy DOM and cannot verify layout, screenshots, keyboard behavior, or browser rendering.

## Findings addressed during integration

- Bound settlement RPC requests to five seconds and destroy the provider when initial connection fails, allowing an unresponsive node to enter the durable queue.
- Match cached event hashes to the correct occurrence of an action in ledger history. Previously, a catch-up batch with repeated shipment actions could copy the latest hash into an earlier entry. Migration **007** resets the event cursor once; replay repairs differing hashes without duplicate rows.
- Correct old blockchain tests to advance the chain clock before successful future delivery confirmations. Keep the frozen business ABI comparison while explicitly checking the supplemental Solidity `operator()` getter.
- Pin deterministic dataset fixture line endings to LF across Windows/Linux and declare the AI test client's `httpx` dependency in `requirements-test.txt`.

## Evidence and remaining acceptance

Generated local evidence is stored in the ignored `artifacts/integration/` directory:

- `report.json`: individual API assertions and settlement/event outputs.
- `acceptance.json`: test-suite exit codes, durations, log paths and pending checks.
- `*-tests.log`, `dashboard-tests-build.log`, `blockchain-portability.log`: full command outputs.
- `shipper-contract-dom.html`, `auditor-contract-dom.html`: component DOM from the live platform, **not screenshots**.
- `.env.validation`, `sessions.json`: local credentials; never attach or commit these.

The committed snapshots in [validation-evidence](validation-evidence/) contain only synthetic/public test evidence, never the credential files. Do not mark a phase Done merely because API tests pass.

| SRS / phase acceptance item | Evidence / remaining work |
|---|---|
| Synthetic plan with utilization, cost and on-time metrics | AI suite and Phase 26 API report; record the allocation screen in a browser |
| Accepted plan creates a contract with correct terms | API terms-hash check plus actual on-chain agreement |
| Late delivery reduces net payout | Exact late and on-time scenario assertions plus blockchain vectors |
| All four dashboard screens navigable | Dashboard tests and live component integration; browser capture of Overview, Allocations, Contracts, and embedded Tracking/Settlement remains required |
| Clean documented reset | Isolated reset/start command above; never use it to claim an external machine has been tested |
| Actual chain process stop/restart | **Pending.** Hardhat keeps the ledger in memory. Pause/resume proves an RPC outage; process restart discards ledger history and is not equivalent. A persistent local-node solution or separately approved change to this acceptance criterion is required |
| Other machine and unfamiliar user | **Pending by user instruction.** Collect the run output and independent walkthrough before final acceptance |
| All Phase 0–26 checklists complete | **Pending.** Teammate machine checks, Phase 25 responsive/keyboard review and independent walkthrough remain open in README; historical unchecked boxes in the development plan must not be silently ticked |

## Manual recording and external-machine checklist

1. On the second Windows machine, clone the repository, start Docker Desktop, run the full acceptance command, and retain `report.json`, `acceptance.json` and suite logs. Record OS, Docker version, commit SHA, date and who ran it.
2. Reset the validation demo. Sign in as Shipper. Show healthy services, enter a 240-tonne coal order to Port-A with a future deadline, optimize, rerun with different weights, and accept with the canonical terms: freight `2500000`, 200 basis points per 21600-second block, six free holding hours, `500` paise per wagon-hour, 12 wagons. Use the seeded Carrier wallet shown in the integration script. Keep each role in a separate browser profile or sign out before switching roles.
3. As Carrier, book and dispatch; record destination arrival and proof of delivery. For the exact late reference, use arrival SLA+3h and delivery SLA+13h. The node clock must first advance beyond delivery (the automated script does this); the UI must not bypass timestamp validation.
4. As Administrator, release and close after resolving any dispute. As Shipper, show ₹1,500 penalty, ₹240 demurrage and ₹23,260 net. As Auditor, show immutable history and absence of mutation controls/private money.
5. Record the UI at 375, 768 and 1280 pixels. Check focus order, visible focus, form labels/errors, keyboard submission/navigation, table scrolling, reduced motion, service failure, alert updates and CSV downloads. The contract page contains the Tracking/Settlement screen.
6. Ask an unfamiliar person to complete order → plan without coaching. Record completion, wrong turns, questions, and any changes needed. Keep screenshots free of passwords/tokens.

The browser automation connection was unavailable during this local run. HTTP and component evidence is recorded separately from the outstanding visual review.
