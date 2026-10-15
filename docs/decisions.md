# ChainRoute Team Decisions

Phase 1 decisions and interface contracts approved by all three team members on 2026-10-15.

| # | Decision | Approved choice | Reason | Approval |
|---|---|---|---|---|
| 1 | Money unit and currency | INR, represented everywhere off-chain and on-chain as integer paise. The reference freight value `2500000` therefore means INR 25,000. | Integer minor units avoid floating-point errors in deductions and settlement. | Alim, Parth, and Elish approved, 2026-10-15 |
| 2 | Source of SLA deadline | For the single agreement created from an accepted plan, use the earliest stated deadline among the orders included in that plan. The backend derives it; clients cannot override it. The plan ETA is a prediction, not a contractual deadline. | Preserves the one-contract-per-plan API and ensures the aggregated agreement does not promise a later time than any included order. | Alim, Parth, and Elish approved, 2026-10-15 |
| 3 | Allocation and learning approach | OR-Tools CP-SAT for constrained allocation. Logistic regression predicts per-order on-time delivery probability from order/route features; use a clearly labelled heuristic fallback when the model is unavailable or untrained. | CP-SAT directly models capacity and compatibility constraints; the probability target feeds the on-time score and dashboard metric. | Alim, Parth, and Elish approved, 2026-10-15 |
| 4 | Unassigned orders and malformed AI input | Reason codes: `NO_COMPATIBLE_WAGON`, `NO_ROUTE`, `INSUFFICIENT_CAPACITY`, `NO_FEASIBLE_ASSIGNMENT`, `TIME_BUDGET_EXCEEDED`. Invalid optimize requests return HTTP 400 using the shared error body and field-level `fields` map. | Stable machine-readable reasons let the platform explain dropped orders without coupling to Track 1 internals. | Alim, Parth, and Elish approved, 2026-10-15 |
| 5 | HTTP errors | Use `{"error":{"code":"STRING_CODE","message":"human text","fields":{"field":"why"}}}` (`fields` optional); statuses per `docs/Plan.md` §8: 400, 401, 403, 404, 409, and 503. Also use 502 for invalid upstream responses and 504 for upstream timeouts as required by later phases. | Consistent error parsing across dashboard, platform, and service boundaries; 404 avoids disclosing unauthorized resources. | Alim, Parth, and Elish approved, 2026-10-15 |
| 6 | On-chain caller permissions | Operator creates agreements, releases payment, and closes contracts; assigned carrier confirms booking, posts shipment status, and confirms delivery; either contract party may raise a dispute; configured arbitrator/admin resolves it; reads are public. Carrier/party identity arguments must match `msg.sender`. | Matches the plan's operator/carrier model while enforcing party identity in the contract, not only in the backend. | Alim, Parth, and Elish approved, 2026-10-15 |
| 7 | Track 3 backend language | TypeScript on Node.js 22. No contract shape depends on this choice. | One language/toolchain for the API and dashboard owner, while keeping the wire contracts language-neutral. | Alim, Parth, and Elish approved, 2026-10-15 |
| 8 | Additional performance target | Backend read endpoints: p95 below 500 ms with 20 concurrent clients in normal demo conditions. No additional target is set for other endpoints; the optimizer retains the plan's qualitative target. | A measurable read-path target is useful for acceptance without over-constraining optimizer or blockchain latency. | Alim, Parth, and Elish approved, 2026-10-15 |

## Review and sign-off

| Member | Assigned workstream | Contract review / approval | Date | Notes |
|---|---|---|---|---|
| Alim | Track 1 — AI/ML Allocation Engine | Approved decisions and all three interface contracts | 2026-10-15 | |
| Parth | Track 2 — Blockchain Settlement Layer | Approved decisions and all three interface contracts | 2026-10-15 | Approval relayed by Alim. |
| Elish | Track 3 — Platform (Backend API + Dashboard) | Approved decisions and all three interface contracts | 2026-10-15 | Approval relayed by Alim. |

## Decisions intentionally deferred to their implementation phases

The development plan calls out additional choices in later phases; they are not silently fixed by this interface freeze.

| Phase | Deferred decision |
|---|---|
| 3 | Synthetic cargo/wagon categories and compatibility rules |
| 6 | CP-SAT objective/search budget and tie-breaking specifics |
| 7 | Training/validation split, accuracy tolerance, training-data source/retraining trigger, and model-version policy |
| 8 | Track 1 run-log storage implementation |
| 10 | Exact term-validation rules and zero-wagon agreement policy; history is stored on-chain and mirrored by events to satisfy `getContractStatus`'s full-history response. |
| 11 | Whether equal status timestamps are accepted; status values are fixed in `blockchain.md` |
| 12 | Demurrage boundary details, total-deduction cap allocation, timestamp trust simplification |
| 14 | Dispute-eligible states and whether a resolved contract may be disputed again; outcome values are fixed to `UpholdDeductions`, `WaivePenalty`, and `WaiveAll` in `blockchain-enums.json` following the plan's recommendations. |
