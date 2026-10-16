from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from models import Assignment, Route, Weights, Wagon

COST_PAISE_PER_WAGON_KM = 250
MAX_ALTERNATIVES = 3

MetricValue = float | str


@dataclass
class CandidatePlan:
    assignments: list[dict[str, Any]]
    unassigned_orders: list[dict[str, str]]
    metrics: dict[str, MetricValue]
    signature: str
    score: float = 0.0


def normalize_weights(weights: Weights) -> dict[str, float]:
    values = {
        "onTime": weights.onTime,
        "cost": weights.cost,
        "utilization": weights.utilization,
    }
    largest = max(values.values())
    if largest == 0:
        return {key: 1 / len(values) for key in values}
    scaled = {key: value / largest for key, value in values.items()}
    total = sum(scaled.values())
    return {key: value / total for key, value in scaled.items()}


def calculate_metrics(
    assignments: list[Assignment],
    order_count: int,
    wagons: list[Wagon],
    routes: list[Route],
) -> dict[str, MetricValue]:
    wagon_by_id = {wagon.wagonId: wagon for wagon in wagons}
    route_by_id = {route.routeId: route for route in routes}
    used_wagons = [
        wagon_by_id[wagon_id]
        for assignment in assignments
        for wagon_id in assignment.wagonIds
    ]
    selected_capacity = sum(wagon.capacityTonnes for wagon in used_wagons)
    assigned_quantity = sum(assignment.quantityTonnes for assignment in assignments)
    utilization = (
        100 * assigned_quantity / selected_capacity if selected_capacity else 0.0
    )
    distance_km = sum(
        route_by_id[assignment.route.routeId].distanceKm
        for assignment in assignments
    )
    cost_paise = sum(
        (
            Decimal(str(route_by_id[assignment.route.routeId].distanceKm))
            * Decimal(len(assignment.wagonIds))
            * COST_PAISE_PER_WAGON_KM
            for assignment in assignments
        ),
        Decimal(0),
    ).to_integral_value(rounding=ROUND_HALF_UP)
    on_time_probability = (
        sum(assignment.onTimeProbability for assignment in assignments) / order_count
        if order_count
        else 0.0
    )
    return {
        "utilizationPercent": utilization,
        "estimatedCostPaise": str(int(cost_paise)),
        "distanceKm": distance_km,
        "onTimeProbability": on_time_probability,
    }


def maximum_possible_cost_paise(wagons: list[Wagon], routes: list[Route]) -> int:
    available_count = sum(wagon.available for wagon in wagons)
    maximum_route_distance = max(
        (Decimal(str(route.distanceKm)) for route in routes),
        default=Decimal(0),
    )
    return int(
        (
            maximum_route_distance
            * available_count
            * COST_PAISE_PER_WAGON_KM
        ).to_integral_value(rounding=ROUND_HALF_UP)
    )


def rank_candidates(
    candidates: list[CandidatePlan],
    weights: Weights,
    order_count: int,
    maximum_cost_paise: int,
) -> list[CandidatePlan]:
    normalized = normalize_weights(weights)
    objective_divisor = order_count + 1
    deduplicated: dict[str, CandidatePlan] = {}
    for candidate in candidates:
        deduplicated.setdefault(candidate.signature, candidate)

    for candidate in deduplicated.values():
        assigned_order_count = len(
            {assignment["orderId"] for assignment in candidate.assignments}
        )
        coverage = (
            min(1.0, assigned_order_count / order_count) if order_count else 0.0
        )
        on_time_score = _metric(candidate, "onTimeProbability")
        utilization_score = _metric(candidate, "utilizationPercent") / 100
        cost_paise = int(str(candidate.metrics["estimatedCostPaise"]))
        cost_efficiency = (
            max(0.0, min(1.0, 1 - cost_paise / maximum_cost_paise))
            if maximum_cost_paise > 0
            else 0.0
        )
        weighted_metrics = (
            normalized["onTime"] * on_time_score
            + normalized["cost"] * cost_efficiency
            + normalized["utilization"] * utilization_score
        )
        candidate.score = coverage + weighted_metrics / objective_divisor

    return sorted(
        deduplicated.values(),
        key=lambda candidate: (
            -candidate.score,
            -len(candidate.assignments),
            candidate.signature,
        ),
    )


def _metric(candidate: CandidatePlan, name: str) -> float:
    return float(candidate.metrics[name])
