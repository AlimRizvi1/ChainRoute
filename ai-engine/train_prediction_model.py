import argparse
import hashlib
import json
import math
import random
from pathlib import Path
from typing import Any

from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split

from prediction import MODEL_PATH

SEED = 42
SAMPLE_COUNT = 30_000
MAE_TOLERANCE = 0.10
CARGO_VARIABILITY = {"grain": 0.10, "coal": 0.20, "steel": 0.30}


def train_model(output_path: Path = MODEL_PATH) -> dict[str, Any]:
    rng = random.Random(SEED)
    features: list[list[float]] = []
    outcomes: list[int] = []
    expected_probabilities: list[float] = []
    for _ in range(SAMPLE_COUNT):
        variability = rng.choice(list(CARGO_VARIABILITY.values()))
        slack_ratio = rng.triangular(-0.99, 10.0, 0.0)
        sigma = math.sqrt(math.log1p(variability**2))
        threshold = math.log1p(slack_ratio) + 0.5 * sigma**2
        expected_probability = 0.5 * (
            1 + math.erf(threshold / (sigma * math.sqrt(2)))
        )
        simulated_transit_factor = math.exp(
            rng.gauss(0.0, sigma) - 0.5 * sigma**2
        )
        on_time = simulated_transit_factor <= 1 + slack_ratio
        features.append([slack_ratio, variability])
        outcomes.append(int(on_time))
        expected_probabilities.append(expected_probability)

    (
        train_features,
        validation_features,
        train_outcomes,
        validation_outcomes,
        _,
        validation_probabilities,
    ) = train_test_split(
        features,
        outcomes,
        expected_probabilities,
        test_size=0.20,
        random_state=SEED,
        stratify=outcomes,
    )
    estimator = LogisticRegression(
        C=1000.0,
        max_iter=1000,
        random_state=SEED,
    )
    estimator.fit(train_features, train_outcomes)
    predictions = estimator.predict_proba(validation_features)[:, 1]
    held_out_mae = sum(
        abs(float(prediction) - expected)
        for prediction, expected in zip(predictions, validation_probabilities)
    ) / len(validation_probabilities)
    if held_out_mae > MAE_TOLERANCE:
        raise ValueError(
            f"Held-out probability MAE {held_out_mae:.4f} exceeds "
            f"the tolerance {MAE_TOLERANCE:.2f}"
        )
    held_out_brier = sum(
        (float(prediction) - outcome) ** 2
        for prediction, outcome in zip(predictions, validation_outcomes)
    ) / len(validation_outcomes)

    dataset_hash = hashlib.sha256(
        json.dumps(
            [
                [feature[0], feature[1], outcome]
                for feature, outcome in zip(features, outcomes)
            ],
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    model_payload = {
        "intercept": float(estimator.intercept_[0]),
        "coefficients": [float(value) for value in estimator.coef_[0]],
        "cargoVariability": CARGO_VARIABILITY,
        "trainingDataHash": f"sha256:{dataset_hash}",
        "training": {
            "source": "synthetic_lognormal_transit_simulation",
            "seed": SEED,
            "sampleCount": SAMPLE_COUNT,
            "trainingFraction": 0.8,
            "heldOutMae": held_out_mae,
            "heldOutBrierScore": held_out_brier,
            "maeTolerance": MAE_TOLERANCE,
        },
    }
    version_hash = hashlib.sha256(
        json.dumps(model_payload, sort_keys=True, separators=(",", ":")).encode(
            "utf-8"
        )
    ).hexdigest()
    artifact = {
        "modelVersion": f"logreg-{version_hash[:16]}",
        **model_payload,
    }
    output_path.write_text(
        json.dumps(artifact, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return artifact


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train and write the deterministic on-time logistic model."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=MODEL_PATH,
        help="Path for the trained JSON model artifact.",
    )
    args = parser.parse_args()
    artifact = train_model(args.output)
    print(
        f"model={artifact['modelVersion']} "
        f"held_out_mae={artifact['training']['heldOutMae']:.4f} "
        f"held_out_brier={artifact['training']['heldOutBrierScore']:.4f} "
        f"output={args.output}"
    )


if __name__ == "__main__":
    main()
