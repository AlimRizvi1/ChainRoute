import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from models import Order, Route
from ranking import CandidatePlan
from synthetic_data import SYNTHETIC_START

MODEL_PATH = Path(__file__).with_name("on_time_model.json")
MAX_ABS_SLACK_RATIO = 100.0


@dataclass(frozen=True)
class LogisticRegressionModel:
    intercept: float
    coefficients: tuple[float, float]
    cargo_variability: dict[str, float]
    model_version: str
    held_out_mae: float


def load_prediction_model() -> LogisticRegressionModel | None:
    try:
        serialized = MODEL_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None

    raw: Any = json.loads(serialized)
    try:
        coefficients = [float(value) for value in raw["coefficients"]]
        if len(coefficients) != 2:
            raise ValueError("Expected two logistic regression coefficients")
        model_version = raw["modelVersion"]
        if not isinstance(model_version, str):
            raise ValueError("Model version must be a string")
        model = LogisticRegressionModel(
            intercept=float(raw["intercept"]),
            coefficients=(coefficients[0], coefficients[1]),
            cargo_variability={
                str(key): float(value)
                for key, value in raw["cargoVariability"].items()
            },
            model_version=model_version,
            held_out_mae=float(raw["training"]["heldOutMae"]),
        )
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        raise ValueError(f"Invalid on-time prediction model at {MODEL_PATH}") from error

    if (
        len(model.coefficients) != 2
        or not model.model_version
        or not math.isfinite(model.intercept)
        or not all(math.isfinite(value) for value in model.coefficients)
        or not all(
            math.isfinite(value) and value > 0
            for value in model.cargo_variability.values()
        )
        or not math.isfinite(model.held_out_mae)
        or not 0 <= model.held_out_mae <= 1
        or model.coefficients[0] <= 0
    ):
        raise ValueError(f"Invalid on-time prediction model at {MODEL_PATH}")
    return model


def predict_probability(
    model: LogisticRegressionModel,
    order: Order,
    route: Route,
) -> float | None:
    variability = model.cargo_variability.get(order.cargoType)
    if variability is None:
        return None
    if route.transitTimeSeconds <= 0:
        raise ValueError("Route transit time must be positive for prediction")

    slack_seconds = (
        order.deadline - SYNTHETIC_START
    ).total_seconds() - route.transitTimeSeconds
    slack_ratio = max(
        -MAX_ABS_SLACK_RATIO,
        min(MAX_ABS_SLACK_RATIO, slack_seconds / route.transitTimeSeconds),
    )
    intercept = model.intercept
    slack_coefficient, variability_coefficient = model.coefficients
    logit = (
        intercept
        + slack_coefficient * slack_ratio
        + variability_coefficient * variability
    )
    if logit >= 0:
        return 1 / (1 + math.exp(-logit))
    exp_logit = math.exp(logit)
    return exp_logit / (1 + exp_logit)


def predict_or_fallback(
    model: LogisticRegressionModel | None,
    order: Order,
    route: Route,
) -> tuple[float, str]:
    probability = (
        predict_probability(model, order, route) if model is not None else None
    )
    if probability is None:
        return _heuristic_probability(order, route), "heuristic_fallback"
    return probability, "logistic_regression"


def apply_candidate_predictions(
    candidates: list[CandidatePlan],
    orders: list[Order],
    routes: list[Route],
) -> tuple[str, str | None]:
    model = load_prediction_model()
    orders_by_id = {order.orderId: order for order in orders}
    routes_by_id = {route.routeId: route for route in routes}
    used_methods: set[str] = set()

    for candidate in candidates:
        probabilities: list[float] = []
        for assignment in candidate.assignments:
            order = orders_by_id[assignment["orderId"]]
            route = routes_by_id[assignment["route"]["routeId"]]
            probability, method = predict_or_fallback(model, order, route)
            used_methods.add(method)
            assignment["onTimeProbability"] = probability
            assignment["score"] = probability
            probabilities.append(probability)
        candidate.metrics["onTimeProbability"] = (
            sum(probabilities) / len(orders) if orders else 0.0
        )

    if used_methods == {"logistic_regression"}:
        return "logistic_regression", model.model_version if model else None
    if used_methods == {"logistic_regression", "heuristic_fallback"}:
        return "mixed", model.model_version if model else None
    return "heuristic_fallback", None


def _heuristic_probability(order: Order, route: Route) -> float:
    slack_seconds = (
        order.deadline - SYNTHETIC_START
    ).total_seconds() - route.transitTimeSeconds
    slack_seconds = max(0.0, slack_seconds)
    return 0.5 + 0.5 * slack_seconds / (
        slack_seconds + route.transitTimeSeconds
    )
