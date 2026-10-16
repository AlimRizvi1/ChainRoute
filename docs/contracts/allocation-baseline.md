# Rule-Based Allocation Baseline and Phase 5 Ranking

`ai-engine/allocator.py` implements four deterministic Phase 4-style greedy candidates behind `POST /v1/optimize`. `ai-engine/ranking.py` computes Phase 5 metrics, normalizes weights, scores candidates, and selects the winner. The optimizer validates its result against the response model before serializing it.

## Deterministic allocation rules

1. The baseline processes orders by ascending priority number (1 first), earliest deadline, then `orderId`. Candidate variants also process by deadline first.
2. For each order, consider only routes to its destination that start where eligible wagons are located. The baseline sorts routes by ascending distance, then `routeId`; one candidate sorts by transit time first.
3. Match cargo to wagon type using the approved Phase 3 mapping. Only unused, available wagons at the route origin are eligible.
4. Select wagons by descending capacity, then `wagonId`, until their combined capacity covers the order. One candidate uses ascending capacity. A wagon is reserved for no more than one assignment in the plan.
5. Depart at the fixed synthetic plan start `2026-01-07T20:00:00Z` with zero dwell time. ETA is departure plus the route's `transitTimeSeconds`. Skip a route if that ETA exceeds the order deadline; if all capacity-feasible routes miss the deadline, report `NO_FEASIBLE_ASSIGNMENT`.

This is a greedy baseline, not a global search. A failed assignment does not consume wagons; later orders may still use them. Its stable sort and tie-break rules make allocation choices repeatable for the same request. Duplicate candidate allocations are removed. Plan and run identifiers, generation time, and runtime metadata are intentionally new for each call.

## Unassigned-order reasons

| Reason code | Phase 4 meaning |
|---|---|
| `NO_ROUTE` | No route has the order's destination. |
| `NO_COMPATIBLE_WAGON` | Cargo has no compatibility mapping, or there is no wagon of the mapped type at any matching route origin. |
| `INSUFFICIENT_CAPACITY` | Remaining available, compatible wagons at every matching route origin cannot cover the quantity. Includes exhausted or unavailable capacity. |
| `NO_FEASIBLE_ASSIGNMENT` | Capacity is sufficient, but every feasible route would miss the deadline. |

The frozen Phase 1 reason enum does not contain the Phase 4 test table's suggested `INSUFFICIENT_WAGONS`; this implementation uses the contract's `INSUFFICIENT_CAPACITY` instead.

## Phase 5 metrics and scoring

Utilization is assigned tonnes divided by capacity of selected wagons. Distance counts one selected route per assigned order. Estimated cost is 250 paise per wagon-kilometre, rounded to integer paise after summing. Assignment and plan on-time probabilities use the deadline-slack heuristic documented in the [AI engine contract](./ai-engine.md); unassigned orders contribute zero to the plan metric.

The nonnegative weights are normalized and all-zero weights become equal thirds. Score is assigned-order coverage plus the weighted mean metric score divided by `(order count + 1)`, so coverage takes precedence over metric gains. Cost efficiency is scaled against the maximum cost implied by the longest route and all available wagons. The winning plan includes its score; at most three distinct ranked alternatives are returned.
