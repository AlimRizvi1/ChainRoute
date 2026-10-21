"""Evaluate the frozen model and save real HTTP examples for the teaching demo.

Does not fit or replace the model. All samples are explicitly synthetic.
"""
import argparse
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from sklearn.model_selection import train_test_split

from models import AllocationPlan, OptimizeRequest, Order, Route
from prediction import MODEL_PATH, load_prediction_model, predict_probability
from synthetic_data import SYNTHETIC_START
from train_prediction_model import SEED, generate_training_data


def demo_request(slack_ratio: float, cargo: str = "grain") -> dict:
    if cargo not in {"grain", "coal", "steel"}:
        raise ValueError("Demo cargo must be grain, coal, or steel")
    deadline = SYNTHETIC_START + timedelta(seconds=14_400 * (1 + slack_ratio))
    request = {
        "orders": [{"orderId": "ML-DEMO", "cargoType": cargo,
                    "quantityTonnes": 10.0, "destination": "Port-A", "priority": 1,
                    "deadline": deadline.isoformat().replace("+00:00", "Z")}],
        "wagons": [{"wagonId": "DEMO-WAGON", "capacityTonnes": 20.0,
                    "wagonType": {"grain": "covered", "coal": "open", "steel": "flat"}[cargo],
                    "location": "Yard-0", "available": True}],
        "routes": [{"routeId": "DEMO-ROUTE", "origin": "Yard-0", "destination": "Port-A",
                    "distanceKm": 100.0, "transitTimeSeconds": 14_400}],
        "weights": {"onTime": 1.0, "cost": 0.0, "utilization": 0.0},
        "timeBudgetSeconds": 0.05,
    }
    OptimizeRequest.model_validate(request)
    return request


def evaluate_model() -> dict:
    artifact = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
    model = load_prediction_model()
    if model is None:
        raise ValueError("Trained model is missing; no heuristic evaluation is allowed")
    features, outcomes, expected = generate_training_data()
    dataset_hash = "sha256:" + hashlib.sha256(json.dumps(
        [[f[0], f[1], y] for f, y in zip(features, outcomes)], separators=(",", ":")
    ).encode("utf-8")).hexdigest()
    if dataset_hash != artifact["trainingDataHash"]:
        raise ValueError("Simulation differs from the saved model's training dataset")
    _, test_x, _, test_y, _, test_expected = train_test_split(
        features, outcomes, expected, test_size=0.20, random_state=SEED, stratify=outcomes
    )
    probabilities = []
    cargo_by_variability = {v: k for k, v in model.cargo_variability.items()}
    for slack, variability in test_x:
        request = demo_request(slack, cargo_by_variability[variability])
        probability = predict_probability(
            model, Order.model_validate(request["orders"][0]), Route.model_validate(request["routes"][0])
        )
        if probability is None:
            raise ValueError("Evaluation unexpectedly used an unsupported cargo")
        probabilities.append(probability)
    n = len(test_y)
    tp = sum(y == 1 and p >= 0.5 for y, p in zip(test_y, probabilities))
    tn = sum(y == 0 and p < 0.5 for y, p in zip(test_y, probabilities))
    fp = sum(y == 0 and p >= 0.5 for y, p in zip(test_y, probabilities))
    fn = sum(y == 1 and p < 0.5 for y, p in zip(test_y, probabilities))
    mae = sum(abs(p - expected_p) for p, expected_p in zip(probabilities, test_expected)) / n
    brier = sum((p - y) ** 2 for p, y in zip(probabilities, test_y)) / n
    # Timestamps have microsecond resolution; allow negligible rounding from feature reconstruction.
    if abs(mae - artifact["training"]["heldOutMae"]) > 1e-9:
        raise ValueError("Frozen model MAE does not reproduce the recorded artifact")
    if abs(brier - artifact["training"]["heldOutBrierScore"]) > 1e-9:
        raise ValueError("Frozen model Brier score does not reproduce the recorded artifact")
    return {
        "modelVersion": model.model_version,
        "trainingDataHash": dataset_hash,
        "dataSource": "synthetic_lognormal_transit_simulation",
        "seed": SEED, "totalSamples": len(features), "trainingSamples": len(features) - n,
        "testSamples": n, "threshold": 0.5,
        "probabilityMae": mae, "brierScore": brier, "maeTolerance": artifact["training"]["maeTolerance"],
        "accuracy": (tp + tn) / n,
        "alwaysOnTimeAccuracy": sum(test_y) / n,
        "onTimePrecision": tp / (tp + fp) if tp + fp else 0,
        "onTimeRecall": tp / (tp + fn) if tp + fn else 0,
        "lateRecall": tn / (tn + fp) if tn + fp else 0,
        "confusionMatrix": {"trueOnTime": tp, "trueLate": tn, "falseOnTime": fp, "falseLate": fn},
        "coefficients": {"intercept": model.intercept, "slackRatio": model.coefficients[0],
                         "cargoVariability": model.coefficients[1]},
        "cargoVariability": model.cargo_variability,
        "limitations": [
            "Synthetic holdout from the same simulator; no real railway test dataset.",
            "Accuracy uses a 0.5 threshold; probability MAE is not classification accuracy.",
            "The model uses a fixed synthetic departure: 2026-01-07T20:00:00Z.",
            "No claim of production accuracy, temporal validation, or real-world calibration.",
        ],
    }


def demonstrate(api_url: str) -> dict:
    evaluation = evaluate_model()
    cases = []
    for slack in (0.0, 0.25, 0.5):
        payload = demo_request(slack)
        request = Request(api_url.rstrip("/") + "/v1/optimize", data=json.dumps(payload).encode(),
                          headers={"Content-Type": "application/json"}, method="POST")
        with urlopen(request, timeout=30) as response:
            plan = json.load(response)
        AllocationPlan.model_validate_json(json.dumps(plan))
        prediction = plan["runMetadata"]["prediction"]
        if prediction != {"method": "logistic_regression", "modelVersion": evaluation["modelVersion"]}:
            raise ValueError("Running API is not using the evaluated model")
        expected = predict_probability(load_prediction_model(), Order.model_validate(payload["orders"][0]),
                                       Route.model_validate(payload["routes"][0]))
        if len(plan["assignments"]) != 1 or abs(plan["assignments"][0]["onTimeProbability"] - expected) > 1e-12:
            raise ValueError("API prediction differs from the frozen model")
        with urlopen(api_url.rstrip("/") + "/v1/runs/" + plan["runId"], timeout=10) as response:
            trace = json.load(response)
        if trace["runId"] != plan["runId"]:
            raise ValueError("Run trace could not be retrieved")
        cases.append({"slackRatio": slack, "request": payload, "response": plan})
    return {"evaluatedAt": datetime.now(timezone.utc).isoformat(), "evaluation": evaluation,
            "syntheticDeparture": SYNTHETIC_START.isoformat(), "recordedExamples": cases}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://localhost:8000")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).with_name("demo"))
    args = parser.parse_args()
    evidence = demonstrate(args.api_url)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = args.output_dir / "evidence.json"
    output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"evaluation": evidence["evaluation"], "liveExamples": [
        {"slackRatio": c["slackRatio"], "probability": c["response"]["assignments"][0]["onTimeProbability"],
         "runId": c["response"]["runId"]} for c in evidence["recordedExamples"]], "output": str(output)}, indent=2))
