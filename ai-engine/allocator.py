import hashlib
import json
import time
import uuid
from datetime import datetime, timedelta, timezone

from models import AllocationPlan, Assignment, OptimizeRequest, Route, Wagon
from synthetic_data import CARGO_TO_WAGON, SYNTHETIC_START

ALGORITHM = "rule-based-baseline-v1"
DWELL_TIME = timedelta(0)


def build_allocation_plan(request: OptimizeRequest) -> dict:
    started_at = time.perf_counter()
    run_id = uuid.uuid4().hex
    used_wagon_ids: set[str] = set()
    assignments: list[Assignment] = []
    unassigned_orders: list[dict[str, str]] = []

    orders = sorted(
        request.orders,
        key=lambda order: (order.priority, order.deadline, order.orderId),
    )

    for order in orders:
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
                key=lambda wagon: (-wagon.capacityTonnes, wagon.wagonId),
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
                    "NO_COMPATIBLE_WAGON",
                    f"No unused available {expected_wagon_type} wagons are at a route origin.",
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
                onTimeProbability=1.0,
                score=1.0,
            )
        )
        used_wagon_ids.update(wagon.wagonId for wagon in selected_wagons)

    wagon_by_id = {wagon.wagonId: wagon for wagon in request.wagons}
    assigned_capacity = sum(
        wagon_by_id[wagon_id].capacityTonnes
        for assignment in assignments
        for wagon_id in assignment.wagonIds
    )
    assigned_quantity = sum(
        assignment.quantityTonnes for assignment in assignments
    )
    utilization = (
        100 * assigned_quantity / assigned_capacity if assigned_capacity else 0.0
    )
    distance = sum(
        next(
            route.distanceKm
            for route in request.routes
            if route.routeId == assignment.route.routeId
        )
        for assignment in assignments
    )
    on_time_probability = len(assignments) / len(request.orders) if request.orders else 0.0
    request_json = json.dumps(
        request.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
    )
    generated_at = datetime.now(timezone.utc)
    result = {
        "planId": f"plan-{run_id}",
        "runId": run_id,
        "assignments": [assignment.model_dump() for assignment in assignments],
        "metrics": {
            "utilizationPercent": utilization,
            "estimatedCostPaise": "0",
            "distanceKm": distance,
            "onTimeProbability": on_time_probability,
        },
        "unassignedOrders": unassigned_orders,
        "alternatives": [],
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
