# Track 1 — AI/ML Allocation Engine API

**Interface version:** `1.0.0`  
**Base URL (local):** `http://ai-engine:8000` from the Compose network  
**Machine-readable schema:** [`ai-engine.schema.json`](./ai-engine.schema.json)

Track 1 is stateless per optimization request. It does not call the platform, database, or blockchain.

## `GET /health`

Returns HTTP `200` and `{"status":"ok"}` when the service can accept requests.

## `POST /v1/optimize`

Accepts JSON matching the `optimizeRequest` definition in `ai-engine.schema.json`; returns HTTP `200` with a JSON `allocationPlan`.

### Request

- `orders`: zero or more orders; quantity is in tonnes, priority is `1` (highest) through `3` (lowest), and `deadline` is an ISO-8601 UTC timestamp.
- `wagons`: zero or more wagons; `available` is explicit and capacity is in tonnes.
- `routes`: zero or more directed origin/destination routes; distance is in kilometres and transit time in seconds.
- `weights`: each of `onTime`, `cost`, and `utilization` is any finite nonnegative number. The engine normalizes them internally, so callers need not pre-normalize; all-zero weights are treated as equal thirds.
- `timeBudgetSeconds` (optional): CP-SAT search budget in seconds, from `0.05` to `10`; defaults to `1`.

### Response

- `planId`, `runId`: opaque non-empty strings.
- `score`: nonnegative combined score. The search first preserves the lexicographically best priority-tier assignment profile; within that profile, coverage is primary and normalized weighted metrics break ties so a lower-coverage candidate cannot win solely by being cheaper.
- `assignments`: each order appears at most once; assignments include cargo type, wagon IDs, selected route, quantity, departure, ETA, per-assignment on-time probability and score.
- `metrics`: utilization is a percentage from 0 to 100; estimated cost is a decimal string of integer paise (never a floating-point JSON number); distance is km; on-time probability is from 0 to 1.
- `unassignedOrders`: includes a stable reason code and user-readable message. Allowed reason codes are `NO_COMPATIBLE_WAGON`, `INCOMPATIBLE_WAGON_TYPE`, `NO_ROUTE`, `INSUFFICIENT_CAPACITY`, `NO_FEASIBLE_ASSIGNMENT`, and `TIME_BUDGET_EXCEEDED`.
- `alternatives`: up to three distinct runner-up allocations, ordered by descending score with deterministic tie-breaking. An empty list is valid when the search found no runner-up.
- `runMetadata`: records the input hash, chosen algorithm, weights, input counts, runtime, and whether logistic regression or the labelled heuristic fallback provided predictions.

### Errors

Invalid request: HTTP `400`, shared error body, `code: "VALIDATION_ERROR"`, and `fields` keyed by invalid field path. Unexpected engine failure: HTTP `500` with the shared error body and no internal stack trace.

## Determinism and boundary rules

- Empty lists are valid inputs. The response is a valid empty plan when there are no assignable orders.
- A well-formed order with no usable route or wagon remains in the request and must appear in `unassignedOrders`; it is not a request-validation error.
- The engine rejects invalid numeric values, priorities outside 1–3, missing required fields, malformed timestamps, and unknown fields.
- `inputHash` is `sha256:` followed by 64 lowercase hexadecimal characters. It is computed from the request serialized using RFC 8785 JSON Canonicalization Scheme (JCS), UTF-8 encoded; the same request produces the same hash.
- The response example in `samples/allocation-plan.json` illustrates shape only; production scores and estimates are computed from the actual input/model.

## Phase 5 scoring

- The deterministic OR-Tools CP-SAT search uses the Phase 4 heuristic plan as a feasible incumbent and hint, enforces priority tiers lexicographically, and searches within the requested budget. The phase-4 heuristics remain candidate fallbacks; duplicate allocations are removed before ranking.
- Utilization is assigned tonnes divided by the capacity of selected wagons, as a percentage. Distance sums the selected route distance once per order. Cost is `250` paise per wagon-kilometre, rounded to the nearest paise after summation. On-time probability is a deadline-slack heuristic: for each feasible assignment, `0.5 + 0.5 × slack / (slack + transit time)`; the plan metric is the probability sum divided by all requested orders, so unassigned orders contribute zero.
- Each metric is scaled to `[0, 1]`: on-time is already a probability, utilization is divided by 100, and cost efficiency is `clamp(1 - cost / maximum_possible_cost, 0, 1)`. The maximum possible cost uses the longest supplied route and all available wagons. If it is zero, cost efficiency is zero.
- Let `N` be the number of orders, `C` the fraction assigned, and `M` the normalized weighted mean of the three scaled metrics. Score is `C + M / (N + 1)` (with `C = 0` for no orders). Across search candidates, lexicographic priority-tier counts are compared first; within the best tier profile, the bounded metric contribution makes coverage take precedence over metric gains. Weights are normalized by their sum, with all-zero weights treated as equal thirds.
- This first on-time estimate is a transparent heuristic, not a trained prediction; Phase 7 may replace it.
- A caller budget is clamped by validation, not silently adjusted: values below `0.05` or above `10` seconds are rejected with HTTP 400. If CP-SAT finds no new solution in time, the always-available feasible heuristic candidate is returned and ranked normally.
