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
- `weights`: each of `onTime`, `cost`, and `utilization` is between `0` and `1`, inclusive. The engine normalizes them internally; callers need not pre-normalize.

### Response

- `planId`, `runId`: opaque non-empty strings.
- `assignments`: each order appears at most once; assignments include cargo type, wagon IDs, selected route, quantity, departure, ETA, per-assignment on-time probability and score.
- `metrics`: utilization is a percentage from 0 to 100; estimated cost is a decimal string of integer paise (never a floating-point JSON number); distance is km; on-time probability is from 0 to 1.
- `unassignedOrders`: includes a stable reason code and user-readable message. Allowed reason codes are `NO_COMPATIBLE_WAGON`, `NO_ROUTE`, `INSUFFICIENT_CAPACITY`, `NO_FEASIBLE_ASSIGNMENT`, and `TIME_BUDGET_EXCEEDED`.
- `alternatives`: ranked candidate allocations. An empty list is valid when the search found no runner-up.
- `runMetadata`: records the input hash, chosen algorithm, weights, input counts, runtime, and whether logistic regression or the labelled heuristic fallback provided predictions.

### Errors

Invalid request: HTTP `400`, shared error body, `code: "VALIDATION_ERROR"`, and `fields` keyed by invalid field path. Unexpected engine failure: HTTP `500` with the shared error body and no internal stack trace.

## Determinism and boundary rules

- Empty lists are valid inputs. The response is a valid empty plan when there are no assignable orders.
- A well-formed order with no usable route or wagon remains in the request and must appear in `unassignedOrders`; it is not a request-validation error.
- The engine rejects invalid numeric values, priorities outside 1–3, missing required fields, malformed timestamps, and unknown fields.
- `inputHash` is `sha256:` followed by 64 lowercase hexadecimal characters. It is computed from the request serialized using RFC 8785 JSON Canonicalization Scheme (JCS), UTF-8 encoded; the same request produces the same hash.
- The response example in `samples/allocation-plan.json` illustrates shape only; production scores and estimates are computed from the actual input/model.
