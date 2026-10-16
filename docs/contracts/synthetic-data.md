# Synthetic Data and Validation Contract

Phase 3 generator and validators live in `ai-engine/synthetic_data.py`. The generator is deterministic for the same order count, seed, and scenario; its output has the `orders`, `wagons`, and `routes` arrays defined by the AI-engine schema.

## Synthetic categories and compatibility

| Cargo type | Compatible wagon type |
|---|---|
| `grain` | `covered` |
| `coal` | `open` |
| `steel` | `flat` |

The generator uses `Yard-0` as its single base and generates a route for each of `Port-A`, `Plant-B`, `Depot-C`, and `Port-D`. Routes use the distance and transit-time values from the Phase 1 sample request. Orders are generated in balanced cargo, destination, and deadline bands, with priorities 1–3 and quantities of 40, 60, 80, or 100 tonnes. Generated wagons have 20-tonne capacity; unavailable wagons are also included when a cargo type has demand.

The `plentiful` scenario provides at least 1.2 times order demand in available capacity for each cargo type. `scarce` provides no more than 0.6 times demand for each cargo type. Comfortable deadlines are one day beyond transit time, tight deadlines are one hour short of transit time, and impossible deadlines are five minutes after the fixed synthetic start time.

## Validation

`validate_orders`, `validate_wagons`, and `validate_routes` each return a `valid` list and a `rejected` list. `validate_master_data` groups the wagon and route results. A rejected item has `{ "id": "...", "reason": "..." }`; if the ID is absent or malformed, `id` is `null`. Validation is per-record and does not discard valid records from the same batch.

Reason codes include `BAD_QUANTITY`, `BAD_PRIORITY`, `BAD_DEADLINE`, `BAD_CAPACITY`, `BAD_DISTANCE`, `BAD_TRANSIT_TIME`, `MISSING_FIELD:<field>`, `EMPTY_FIELD:<field>`, `UNKNOWN_FIELD:<field>`, `INVALID_FIELD:<field>`, and `DUPLICATE_ID`. A repeated ID rejects only its later occurrence within the same record collection. An order with no matching route and an unavailable wagon are still valid records; allocation feasibility is handled in later phases.

The API schema intentionally keeps cargo and wagon type fields open strings. The compatibility table constrains the current synthetic dataset and allocation demo; validation enforces the shared schema rather than rejecting syntactically valid future categories.

Regenerate both 25-order, seed-1 samples with:

```powershell
python ai-engine/generate_samples.py
```

Run the Track 1 tests with:

```powershell
python -m unittest discover -s ai-engine -p "test_*.py"
```
