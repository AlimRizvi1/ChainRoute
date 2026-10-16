# Rule-Based Allocation Baseline

`ai-engine/allocator.py` implements the Phase 4 baseline behind `POST /v1/optimize`. It accepts the frozen Phase 1 request and returns the frozen `AllocationPlan` shape. The optimizer validates its result against the response model before serializing it.

## Deterministic allocation rules

1. Process orders by ascending priority number (1 first), earliest deadline, then `orderId`.
2. For each order, consider only routes to its destination that start where eligible wagons are located. Sort routes by ascending distance, then `routeId`.
3. Match cargo to wagon type using the approved Phase 3 mapping. Only unused, available wagons at the route origin are eligible.
4. Select wagons by descending capacity, then `wagonId`, until their combined capacity covers the order. A wagon is reserved for no more than one assignment in the plan.
5. Depart at the fixed synthetic plan start `2026-01-07T20:00:00Z` with zero dwell time. ETA is departure plus the route's `transitTimeSeconds`. Skip a route if that ETA exceeds the order deadline; if all capacity-feasible routes miss the deadline, report `NO_FEASIBLE_ASSIGNMENT`.

This is a greedy baseline, not a global search. A failed assignment does not consume wagons; later orders may still use them. Its stable sort and tie-break rules make allocation choices repeatable for the same request. Plan and run identifiers, generation time, and runtime metadata are intentionally new for each call.

## Unassigned-order reasons

| Reason code | Phase 4 meaning |
|---|---|
| `NO_ROUTE` | No route has the order's destination. |
| `NO_COMPATIBLE_WAGON` | Cargo has no compatibility mapping, or there is no wagon of the mapped type at any matching route origin. |
| `INSUFFICIENT_CAPACITY` | Remaining available, compatible wagons at every matching route origin cannot cover the quantity. Includes exhausted or unavailable capacity. |
| `NO_FEASIBLE_ASSIGNMENT` | Capacity is sufficient, but every feasible route would miss the deadline. |

The frozen Phase 1 reason enum does not contain the Phase 4 test table's suggested `INSUFFICIENT_WAGONS`; this implementation uses the contract's `INSUFFICIENT_CAPACITY` instead.

## Phase 4 metric limits

Phase 4 populates the required metric fields without introducing the cost model deferred to Phase 5. `estimatedCostPaise` is therefore `"0"` and must not be interpreted as a real price. Utilization is assigned tonnes divided by capacity of the wagons actually selected. Assignment `score` and `onTimeProbability` are `1` for a feasible, on-time assignment. Plan-level `onTimeProbability` is the share of all input orders assigned on time (zero for an empty order set). Phase 5 replaces these provisional scoring semantics with the agreed scoring/ranking model.

The supplied `weights` are validated and preserved in `runMetadata`; they do not affect the Phase 4 baseline choice.
