import json
import time
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR

from ortools.sat.python import cp_model

from models import Assignment, OptimizeRequest, Order, Route, Wagon
from ranking import (
    CandidatePlan,
    COST_PAISE_PER_WAGON_KM,
    calculate_metrics,
    maximum_possible_cost_paise,
    normalize_weights,
)
from synthetic_data import CARGO_TO_WAGON, SYNTHETIC_START

DEFAULT_TIME_BUDGET_SECONDS = 1.0
OBJECTIVE_SCALE = 1_000_000
CAPACITY_SCALE = 1_000_000
MAX_SEARCH_CANDIDATES = 4


def build_search_candidates(
    request: OptimizeRequest,
    incumbent: CandidatePlan,
    time_budget_seconds: float | None,
) -> list[CandidatePlan]:
    budget = (
        DEFAULT_TIME_BUDGET_SECONDS
        if time_budget_seconds is None
        else time_budget_seconds
    )
    expires_at = time.monotonic() + budget
    model = cp_model.CpModel()
    assigned_vars: dict[int, cp_model.IntVar] = {}
    route_vars: dict[tuple[int, int], cp_model.IntVar] = {}
    wagon_vars: dict[tuple[int, int, int], cp_model.IntVar] = {}
    order_routes: dict[int, list[tuple[int, cp_model.IntVar]]] = defaultdict(list)
    order_wagons: dict[
        int, list[tuple[int, int, cp_model.IntVar]]
    ] = defaultdict(list)
    route_wagons: dict[tuple[int, int], list[int]] = defaultdict(list)
    wagon_uses: dict[int, list[cp_model.IntVar]] = defaultdict(list)
    order_options: dict[int, list[tuple[int, int]]] = defaultdict(list)

    orders = request.orders
    wagons = request.wagons
    routes = request.routes
    for order_index, order in enumerate(orders):
        assigned_vars[order_index] = model.NewBoolVar(f"assigned_{order_index}")
        expected_type = CARGO_TO_WAGON.get(order.cargoType)
        if expected_type is None:
            continue
        for route_index, route in enumerate(routes):
            if not _route_is_feasible(order, route):
                continue
            eligible_wagons = [
                wagon_index
                for wagon_index, wagon in enumerate(wagons)
                if wagon.available
                and wagon.wagonType == expected_type
                and wagon.location == route.origin
            ]
            if not eligible_wagons:
                continue
            route_variable = model.NewBoolVar(f"route_{order_index}_{route_index}")
            route_vars[(order_index, route_index)] = route_variable
            order_routes[order_index].append((route_index, route_variable))
            for wagon_index in eligible_wagons:
                variable = model.NewBoolVar(
                    f"wagon_{order_index}_{route_index}_{wagon_index}"
                )
                wagon_vars[(order_index, route_index, wagon_index)] = variable
                route_wagons[(order_index, route_index)].append(wagon_index)
                wagon_uses[wagon_index].append(variable)
                order_options[order_index].append((route_index, wagon_index))
                order_wagons[order_index].append((route_index, wagon_index, variable))

    for order_index, order in enumerate(orders):
        order_route_vars = [variable for _, variable in order_routes[order_index]]
        model.Add(sum(order_route_vars) == assigned_vars[order_index])
        capacity_terms = []
        for route_index, wagon_index in order_options[order_index]:
            variable = wagon_vars[(order_index, route_index, wagon_index)]
            model.Add(variable <= route_vars[(order_index, route_index)])
            capacity_terms.append(
                _capacity_units(wagons[wagon_index].capacityTonnes, ROUND_FLOOR)
                * variable
            )
        for route_index, route_variable in order_routes[order_index]:
            route_wagon_variables = [
                wagon_vars[(order_index, route_index, wagon_index)]
                for wagon_index in route_wagons[(order_index, route_index)]
            ]
            model.Add(route_variable <= sum(route_wagon_variables))
        required_capacity = _capacity_units(order.quantityTonnes, ROUND_CEILING)
        model.Add(
            sum(capacity_terms) >= required_capacity * assigned_vars[order_index]
        )

    for variables in wagon_uses.values():
        model.Add(sum(variables) <= 1)

    _add_incumbent_hints(
        model,
        request,
        incumbent,
        assigned_vars,
        order_routes,
        order_wagons,
    )
    model.Maximize(
        _objective_terms(
            request,
            assigned_vars,
            route_vars,
            wagon_vars,
        )
    )

    candidates: list[CandidatePlan] = []
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0
    solver.parameters.log_search_progress = False

    for _ in range(MAX_SEARCH_CANDIDATES):
        remaining = expires_at - time.monotonic()
        if remaining <= 0.01:
            break
        solver.parameters.max_time_in_seconds = remaining
        status = solver.Solve(model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            break
        candidate = _candidate_from_solution(
            request,
            solver,
            assigned_vars,
            order_routes,
            order_wagons,
        )
        candidates.append(candidate)
        _exclude_solution(model, solver, [*assigned_vars.values(), *wagon_vars.values()])
    return candidates


def _route_is_feasible(order: Order, route: Route) -> bool:
    if route.destination != order.destination:
        return False
    eta = SYNTHETIC_START + timedelta(seconds=route.transitTimeSeconds)
    return eta <= order.deadline


def _add_incumbent_hints(
    model: cp_model.CpModel,
    request: OptimizeRequest,
    incumbent: CandidatePlan,
    assigned_vars: dict[int, cp_model.IntVar],
    order_routes: dict[int, list[tuple[int, cp_model.IntVar]]],
    order_wagons: dict[int, list[tuple[int, int, cp_model.IntVar]]],
) -> None:
    assignments_by_order = {
        assignment["orderId"]: assignment for assignment in incumbent.assignments
    }
    for order_index, order in enumerate(request.orders):
        assignment = assignments_by_order.get(order.orderId)
        assigned = assignment is not None
        model.AddHint(assigned_vars[order_index], int(assigned))
        for route_index, variable in order_routes[order_index]:
            selected = (
                assigned
                and request.routes[route_index].routeId
                == assignment["route"]["routeId"]
            )
            model.AddHint(variable, int(selected))
        for route_index, wagon_index, variable in order_wagons[order_index]:
            selected = (
                assigned
                and request.routes[route_index].routeId
                == assignment["route"]["routeId"]
                and request.wagons[wagon_index].wagonId in assignment["wagonIds"]
            )
            model.AddHint(variable, int(selected))


def _objective_terms(
    request: OptimizeRequest,
    assigned_vars: dict[int, cp_model.IntVar],
    route_vars: dict[tuple[int, int], cp_model.IntVar],
    wagon_vars: dict[tuple[int, int, int], cp_model.IntVar],
) -> cp_model.LinearExpr:
    order_count = len(request.orders)
    weights = normalize_weights(request.weights)
    total_capacity = sum(
        wagon.capacityTonnes for wagon in request.wagons if wagon.available
    )
    maximum_cost = maximum_possible_cost_paise(request.wagons, request.routes)
    tier_base = 6 * OBJECTIVE_SCALE + 1
    priority_coefficients = {
        1: tier_base * (order_count + 1) ** 2,
        2: tier_base * (order_count + 1),
        3: tier_base,
    }
    terms = []
    for order_index, order in enumerate(request.orders):
        terms.append(
            priority_coefficients[order.priority] * assigned_vars[order_index]
        )
        if total_capacity:
            utilization_benefit = int(
                round(
                    weights["utilization"]
                    * order.quantityTonnes
                    / total_capacity
                    * OBJECTIVE_SCALE
                )
            )
            terms.append(utilization_benefit * assigned_vars[order_index])

    for (order_index, route_index), route_variable in route_vars.items():
        order = request.orders[order_index]
        route = request.routes[route_index]
        eta = SYNTHETIC_START + timedelta(seconds=route.transitTimeSeconds)
        slack_seconds = max(0.0, (order.deadline - eta).total_seconds())
        probability = 0.5 + 0.5 * slack_seconds / (
            slack_seconds + route.transitTimeSeconds
        )
        on_time_benefit = int(
            round(
                weights["onTime"]
                * probability
                / max(1, order_count)
                * OBJECTIVE_SCALE
            )
        )
        terms.append(on_time_benefit * route_variable)

    for (order_index, route_index, wagon_index), variable in wagon_vars.items():
        route = request.routes[route_index]
        wagon = request.wagons[wagon_index]
        if total_capacity:
            utilization_cost = int(
                round(
                    weights["utilization"]
                    * wagon.capacityTonnes
                    / total_capacity
                    * OBJECTIVE_SCALE
                )
            )
            terms.append(-utilization_cost * variable)
        if maximum_cost:
            cost_paise = (
                Decimal(str(route.distanceKm))
                * COST_PAISE_PER_WAGON_KM
            )
            cost_penalty = int(
                round(
                    weights["cost"]
                    * float(cost_paise / Decimal(maximum_cost))
                    * OBJECTIVE_SCALE
                )
            )
            terms.append(-cost_penalty * variable)
    return sum(terms)


def _candidate_from_solution(
    request: OptimizeRequest,
    solver: cp_model.CpSolver,
    assigned_vars: dict[int, cp_model.IntVar],
    order_routes: dict[int, list[tuple[int, cp_model.IntVar]]],
    order_wagons: dict[int, list[tuple[int, int, cp_model.IntVar]]],
) -> CandidatePlan:
    assignments: list[Assignment] = []
    assigned_ids: set[str] = set()
    for order_index, order in enumerate(request.orders):
        if not solver.BooleanValue(assigned_vars[order_index]):
            continue
        selected_route_index = next(
            route_index
            for route_index, variable in order_routes[order_index]
            if solver.BooleanValue(variable)
        )
        route = request.routes[selected_route_index]
        selected_wagons = [
            request.wagons[wagon_index]
            for route_index, wagon_index, variable in order_wagons[order_index]
            if route_index == selected_route_index
            and solver.BooleanValue(variable)
        ]
        eta = SYNTHETIC_START + timedelta(seconds=route.transitTimeSeconds)
        slack_seconds = max(0.0, (order.deadline - eta).total_seconds())
        probability = 0.5 + 0.5 * slack_seconds / (
            slack_seconds + route.transitTimeSeconds
        )
        assignments.append(
            Assignment(
                orderId=order.orderId,
                cargoType=order.cargoType,
                wagonIds=sorted(wagon.wagonId for wagon in selected_wagons),
                route={
                    "routeId": route.routeId,
                    "origin": route.origin,
                    "destination": route.destination,
                },
                quantityTonnes=order.quantityTonnes,
                departAt=SYNTHETIC_START,
                eta=eta,
                onTimeProbability=probability,
                score=probability,
            )
        )
        assigned_ids.add(order.orderId)

    unassigned_orders = [
        _unassigned_order(request, order)
        for order in request.orders
        if order.orderId not in assigned_ids
    ]
    serialized_assignments = [assignment.model_dump() for assignment in assignments]
    signature = _allocation_signature(assignments)

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


def _unassigned_order(request: OptimizeRequest, order: Order) -> dict[str, str]:
    matching_routes = [
        route for route in request.routes if route.destination == order.destination
    ]
    if not matching_routes:
        return _unassigned(order.orderId, "NO_ROUTE", "No route serves this destination.")
    expected_type = CARGO_TO_WAGON.get(order.cargoType)
    if expected_type is None:
        return _unassigned(
            order.orderId,
            "NO_COMPATIBLE_WAGON",
            f"No synthetic wagon compatibility rule exists for cargo type '{order.cargoType}'.",
        )

    compatible_inventory = [
        wagon
        for wagon in request.wagons
        if wagon.wagonType == expected_type
        and any(wagon.location == route.origin for route in matching_routes)
    ]
    if not compatible_inventory:
        return _unassigned(
            order.orderId,
            "INCOMPATIBLE_WAGON_TYPE",
            f"No {expected_type} wagon is located at a route origin.",
        )

    deadline_feasible_routes = [
        route for route in matching_routes if _route_is_feasible(order, route)
    ]
    capacity_feasible_routes = [
        route
        for route in matching_routes
        if sum(
            wagon.capacityTonnes
            for wagon in compatible_inventory
            if wagon.available and wagon.location == route.origin
        )
        >= order.quantityTonnes
    ]
    deadline_and_capacity_feasible = any(
        _route_is_feasible(order, route) for route in capacity_feasible_routes
    )
    if capacity_feasible_routes and not deadline_and_capacity_feasible:
        return _unassigned(
            order.orderId,
            "NO_FEASIBLE_ASSIGNMENT",
            "Every capacity-feasible route would miss the order deadline.",
        )
    return _unassigned(
        order.orderId,
        "INSUFFICIENT_CAPACITY",
        "Unused compatible wagons at every route origin cannot cover the order quantity.",
    )


def _allocation_signature(assignments: list[Assignment]) -> str:
    return json.dumps(
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


def _capacity_units(tonnes: float, rounding: str) -> int:
    return int(
        (Decimal(str(tonnes)) * CAPACITY_SCALE).to_integral_value(
            rounding=rounding
        )
    )


def _exclude_solution(
    model: cp_model.CpModel,
    solver: cp_model.CpSolver,
    variables: list[cp_model.IntVar],
) -> None:
    selected = [variable for variable in variables if solver.BooleanValue(variable)]
    unselected = [variable for variable in variables if not solver.BooleanValue(variable)]
    model.Add(sum(selected) - sum(unselected) <= len(selected) - 1)


def _unassigned(order_id: str, reason_code: str, message: str) -> dict[str, str]:
    return {"orderId": order_id, "reasonCode": reason_code, "message": message}
