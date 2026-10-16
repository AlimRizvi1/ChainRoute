import hashlib
import json
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from models import AllocationPlan, Assignment, OptimizeRequest, Route, Wagon
from ranking import (
    MAX_ALTERNATIVES,
    CandidatePlan,
    calculate_metrics,
    maximum_possible_cost_paise,
    rank_candidates,
)
from search_agent import DEFAULT_TIME_BUDGET_SECONDS, build_search_candidates
from synthetic_data import CARGO_TO_WAGON, SYNTHETIC_START

ALGORITHM = "ortools-cp-sat-v1"
DWELL_TIME = timedelta(0)


@dataclass(frozen=True)
class AllocationStrategy:
    process_by_deadline: bool = False
    prefer_smaller_wagons: bool = False
    prefer_faster_routes: bool = False


STRATEGIES = (
    AllocationStrategy(),
    AllocationStrategy(process_by_deadline=True),
    AllocationStrategy(prefer_smaller_wagons=True),
    AllocationStrategy(prefer_faster_routes=True),
)


def build_allocation_plan(request: OptimizeRequest) -> dict:
    started_at = time.perf_counter()
    heuristic_candidates = [
        _build_candidate(request, strategy) for strategy in STRATEGIES
    ]
    candidates = [
        *heuristic_candidates,
        *build_search_candidates(
            request,
            heuristic_candidates[0],
            (
                request.timeBudgetSeconds
                if request.timeBudgetSeconds is not None
                else DEFAULT_TIME_BUDGET_SECONDS
            ),
        ),
    ]
    priority_by_order = {order.orderId: order.priority for order in request.orders}
    best_priority_profile = max(
        _priority_profile(candidate, priority_by_order) for candidate in candidates
    )
    candidates = [
        candidate
        for candidate in candidates
        if _priority_profile(candidate, priority_by_order) == best_priority_profile
    ]
    ranked = rank_candidates(
        candidates,
        request.weights,
        len(request.orders),
        maximum_possible_cost_paise(request.wagons, request.routes),
    )
    winner = ranked[0]
    run_id = uuid.uuid4().hex
    request_json = json.dumps(
        request.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
    )
    generated_at = datetime.now(timezone.utc)
    alternatives = [
        {
            "rank": rank,
            "score": candidate.score,
            "assignments": candidate.assignments,
            "metrics": candidate.metrics,
        }
        for rank, candidate in enumerate(ranked[1 : MAX_ALTERNATIVES + 1], start=1)
    ]
    result = {
        "planId": f"plan-{run_id}",
        "runId": run_id,
        "score": winner.score,
        "assignments": winner.assignments,
        "metrics": winner.metrics,
        "unassignedOrders": winner.unassigned_orders,
        "alternatives": alternatives,
        "runMetadata": {
            "generatedAt": generated_at,
            "durationMs": int((time.perf_counter() - started_at) * 1000),
            "algorithm": ALGORITHM,
            "weights": request.weights.model_dump(),
            "inputHash": f"sha256:{hashlib.sha256(request_json.encode()).hexdigest()}",
            "inputCounts": {
                "orders": len(request.orders),
                "wagons": len(request.wagons),
                "routes": len(request.routes),
            },
            "prediction": {
                "method": "heuristic_fallback",
                "modelVersion": None,
            },
        },
    }
    return AllocationPlan.model_validate(result).model_dump(mode="json")


def _build_candidate(
    request: OptimizeRequest, strategy: AllocationStrategy
) -> CandidatePlan:
    used_wagon_ids: set[str] = set()
    assignments: list[Assignment] = []
    unassigned_orders: list[dict[str, str]] = []

    if strategy.process_by_deadline:
        orders = sorted(
            request.orders,
            key=lambda order: (order.deadline, order.priority, order.orderId),
        )
    else:
        orders = sorted(
            request.orders,
            key=lambda order: (order.priority, order.deadline, order.orderId),
        )

    for order in orders:
        if strategy.prefer_faster_routes:
            matching_routes = sorted(
                (
                    route
                    for route in request.routes
                    if route.destination == order.destination
                ),
                key=lambda route: (
                    route.transitTimeSeconds,
                    route.distanceKm,
                    route.routeId,
                ),
            )
        else:
            matching_routes = sorted(
                (
                    route
                    for route in request.routes
                    if route.destination == order.destination
                ),
                key=lambda route: (route.distanceKm, route.routeId),
            )
        if not matching_routes:
            unassigned_orders.append(
                _unassigned(order.orderId, "NO_ROUTE", "No route serves this destination.")
            )
            continue

        expected_wagon_type = CARGO_TO_WAGON.get(order.cargoType)
        if expected_wagon_type is None:
            unassigned_orders.append(
                _unassigned(
                    order.orderId,
                    "NO_COMPATIBLE_WAGON",
                    f"No synthetic wagon compatibility rule exists for cargo type '{order.cargoType}'.",
                )
            )
            continue

        route_options: list[tuple[Route, list[Wagon], float]] = []
        has_compatible_wagon = False
        for route in matching_routes:
            compatible_inventory = [
                wagon
                for wagon in request.wagons
                if wagon.location == route.origin
                and wagon.wagonType == expected_wagon_type
            ]
            if compatible_inventory:
                has_compatible_wagon = True
            available_wagons = sorted(
                (
                    wagon
                    for wagon in request.wagons
                    if wagon.available
                    and wagon.wagonId not in used_wagon_ids
                    and wagon.location == route.origin
                    and wagon.wagonType == expected_wagon_type
                ),
                key=lambda wagon: (
                    (
                        wagon.capacityTonnes
                        if strategy.prefer_smaller_wagons
                        else -wagon.capacityTonnes
                    ),
                    wagon.wagonId,
                ),
            )
            selected_wagons, capacity = _select_wagons(
                available_wagons, order.quantityTonnes
            )
            if selected_wagons:
                route_options.append((route, selected_wagons, capacity))

        if not has_compatible_wagon:
            unassigned_orders.append(
                _unassigned(
                    order.orderId,
                    "INCOMPATIBLE_WAGON_TYPE",
                    f"No {expected_wagon_type} wagon is located at a route origin.",
                )
            )
            continue
        if not route_options:
            unassigned_orders.append(
                _unassigned(
                    order.orderId,
                    "INSUFFICIENT_CAPACITY",
                    "Unused compatible wagons at every route origin cannot cover the order quantity.",
                )
            )
            continue

        chosen = next(
            (
                option
                for option in route_options
                if SYNTHETIC_START + DWELL_TIME + timedelta(
                    seconds=option[0].transitTimeSeconds
                )
                <= order.deadline
            ),
            None,
        )
        if chosen is None:
            unassigned_orders.append(
                _unassigned(
                    order.orderId,
                    "NO_FEASIBLE_ASSIGNMENT",
                    "The route ETA would miss this order's deadline.",
                )
            )
            continue

        route, selected_wagons, _ = chosen
        depart_at = SYNTHETIC_START + DWELL_TIME
        eta = depart_at + timedelta(seconds=route.transitTimeSeconds)
        slack_seconds = max(0.0, (order.deadline - eta).total_seconds())
        on_time_probability = 0.5 + 0.5 * slack_seconds / (
            slack_seconds + route.transitTimeSeconds
        )
        assignments.append(
            Assignment(
                orderId=order.orderId,
                cargoType=order.cargoType,
                wagonIds=[wagon.wagonId for wagon in selected_wagons],
                route={
                    "routeId": route.routeId,
                    "origin": route.origin,
                    "destination": route.destination,
                },
                quantityTonnes=order.quantityTonnes,
                departAt=depart_at,
                eta=eta,
                onTimeProbability=on_time_probability,
                score=on_time_probability,
            )
        )
        used_wagon_ids.update(wagon.wagonId for wagon in selected_wagons)

    serialized_assignments = [
        assignment.model_dump() for assignment in assignments
    ]
    signature = json.dumps(
        sorted(
            (
                assignment.orderId,
                tuple(sorted(assignment.wagonIds)),
                assignment.route.routeId,
            )
            for assignment in assignments
        ),
        separators=(",", ":"),
    )
    return CandidatePlan(
        assignments=serialized_assignments,
        unassigned_orders=unassigned_orders,
        metrics=calculate_metrics(
            assignments,
            len(request.orders),
            request.wagons,
            request.routes,
        ),
        signature=signature,
    )


def _select_wagons(
    wagons: list[Wagon], required_capacity: float
) -> tuple[list[Wagon], float]:
    selected: list[Wagon] = []
    capacity = 0.0
    for wagon in wagons:
        selected.append(wagon)
        capacity += wagon.capacityTonnes
        if capacity >= required_capacity:
            return selected, capacity
    return [], capacity


def _unassigned(order_id: str, reason_code: str, message: str) -> dict[str, str]:
    return {
        "orderId": order_id,
        "reasonCode": reason_code,
        "message": message,
    }


def _priority_profile(
    candidate: CandidatePlan, priority_by_order: dict[str, int]
) -> tuple[int, int, int]:
    assigned_ids = {assignment["orderId"] for assignment in candidate.assignments}
    return tuple(
        sum(priority_by_order[order_id] == priority for order_id in assigned_ids)
        for priority in (1, 2, 3)
    )
