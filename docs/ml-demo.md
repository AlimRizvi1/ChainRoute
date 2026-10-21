# Demonstrating ChainRoute's machine learning

Open <http://localhost:8000/demo/> while Docker Desktop and the Compose services are running. This teaching page does not require a platform login. It shows live AI-engine predictions and a saved, reproducible evaluation of the same model. API documentation is at <http://localhost:8000/docs>. The platform's allocation workflow remains at <http://localhost:5173/allocations> for Shippers and Administrators.

## A three-minute demonstration

1. Open the demo, keep **Grain** and **No spare time**, and select **Run live prediction**. The real optimizer returns about **51.81%** on-time probability for one synthetic assignment.
2. Select **1 hour spare** and run again: about **88.30%**. Select **2 hours spare** and run again: about **98.15%**. More time before the deadline increases the model's estimate. These probabilities describe the selected assignment; they are not test accuracy.
3. Point to the method `logistic_regression` and model version `logreg-fd10e2acfde0639b` in the result. Expand **Inspect the live request and response** to show the actual API JSON. Open the run audit record to show its input snapshot, hash, parameters, prediction method, and version.
4. Scroll to **How accurate is the model?** Show the test-set metrics, always-on-time baseline, and confusion matrix below. Download the evidence JSON if the teacher wants a copy.
5. Expand the learned equation and explain the distinction between the trained predictor and the CP-SAT optimizer.

The scenarios use the engine's fixed synthetic departure, **7 January 2026 at 20:00 UTC**, with a four-hour route and compatible wagons. Do not replace these deadlines with today's date: this prototype's fixed clock can produce saturated probabilities near 100%. Live runs write AI run traces and the latest AI plan artifact; they do not create platform orders, PostgreSQL allocation plans, or blockchain agreements.

## Explanation to give the teacher

“ChainRoute currently has one trained machine-learning model: logistic regression for on-time delivery probability. We generate 30,000 synthetic delivery examples using a lognormal transit-delay simulator for grain, coal, and steel. We train on 24,000 and evaluate on 6,000 held-out examples using a stratified 80/20 split with random seed 42.

“The model takes two inputs: deadline slack divided by route transit time, and a cargo variability value. It learns an intercept and two coefficients. A sigmoid converts their weighted sum into an on-time probability. The saved JSON artifact contains the learned parameters and a content-derived version, so the API can make predictions without retraining.

“Separately, Google OR-Tools CP-SAT searches wagon allocations that satisfy capacity, cargo compatibility, route, and timing constraints. The engine applies the model's probabilities and ranks candidate allocation plans using configurable on-time, cost, and utilization weights. CP-SAT is a constraint optimizer, not another trained ML model.

“On the synthetic holdout, classification accuracy is 97.35%, compared with 90.92% for predicting every delivery will be on time. Late-delivery recall is 81.65%. Probability MAE against the simulator's analytical probability is 0.00978, and the Brier score against binary outcomes is 0.01918. The model is tested on simulated data; we still need real railway history and validation on future trips before claiming real-world accuracy.”

## Reproduced evaluation

| Measure | Value | Interpretation |
|---|---:|---|
| Test deliveries | 6,000 | Separate from the 24,000 fitting examples |
| Classification accuracy | 97.35% | 5,841 correct labels at threshold 0.50 |
| Always-on-time baseline | 90.92% | 5,455 of the test deliveries are actually on time |
| Improvement over baseline | 6.43 percentage points | Accuracy alone hides the class imbalance |
| Late-delivery recall | 81.65% | 445 of 545 late deliveries detected |
| On-time precision | 98.18% | 5,396 of 5,496 predicted on-time deliveries were on time |
| On-time recall | 98.92% | 5,396 of 5,455 actual on-time deliveries detected |
| Probability MAE | 0.0097755 | About 0.978 percentage points average probability error versus the simulator |
| Brier score | 0.0191757 | Mean squared probability error versus binary outcomes |

| Actual / predicted | On time | Late |
|---|---:|---:|
| On time | 5,396 | 59 |
| Late | 100 | 445 |

**Do not describe MAE as “99.02% accuracy.”** MAE measures probability error; classification accuracy is a separate calculation. This is a same-simulator holdout, not an independent field or future-period test. The report does not establish real-world calibration or a delivery guarantee.

## Where to inspect the implementation

| File | Purpose |
|---|---|
| [Training script](../ai-engine/train_prediction_model.py) | Deterministic simulation, stratified split, scikit-learn fitting, metrics and artifact version |
| [Saved model](../ai-engine/on_time_model.json) | Learned coefficients, dataset hash, version and original validation metrics |
| [Prediction layer](../ai-engine/prediction.py) | Inference, bounded inputs, and explicitly labeled missing-model / unknown-cargo fallback |
| [Allocation agent](../ai-engine/search_agent.py) | CP-SAT constraint search |
| [Ranking](../ai-engine/ranking.py) | Weighted objective and alternatives |
| [Evaluation/demo command](../ai-engine/demonstrate_ml.py) | Evaluate the frozen model, verify dataset hash, call the real API and retrieve traces |
| [Saved evidence](../ai-engine/demo/evidence.json) | Exact metrics and three recorded HTTP requests/responses |

The fallback is a heuristic rather than ML. The live demo checks the returned method and version; it warns if the engine falls back or differs from the evaluated model. Recorded examples are snapshots; their run IDs can be retrieved only while the corresponding local AI run-log volume is retained. Use a fresh live run after resetting volumes.

## Reproduce without replacing the model

From the repository root in PowerShell, with the engine running:

```powershell
$mlSource = (Resolve-Path ai-engine).Path
docker compose run --rm --no-deps -v "${mlSource}:/demo-src" -w /demo-src ai-engine python demonstrate_ml.py --api-url http://ai-engine:8000
docker compose build ai-engine
docker compose up -d --no-deps ai-engine
```

The first command checks the dataset hash, recreates the held-out split, computes inference using the existing artifact, and verifies three HTTP predictions and their retrievable traces. It writes `ai-engine/demo/evidence.json`. Rebuild/restart serves that new report. No model training or database migration is needed. For a metrics-only evaluation without live calls: `docker compose exec ai-engine python -c 'import json; from demonstrate_ml import evaluate_model; print(json.dumps(evaluate_model(), indent=2))'`.

Model and demonstration tests (isolated temporary run-log database):

```powershell
$mlSource = (Resolve-Path ai-engine).Path
docker compose run --rm --no-deps -v "${mlSource}:/demo-src" -w /demo-src -e AI_RUN_LOG_PATH=/tmp/ml-demo-tests.sqlite3 ai-engine python -m unittest test_prediction test_ml_demo test_api -v
```

Retraining to a temporary artifact is tested too. The dataset hash and numerical fit reproduce; final floating-point bits can differ across numerical-library platforms, changing the content-derived model version. The evaluation always uses the checked-in model and does not overwrite it.
