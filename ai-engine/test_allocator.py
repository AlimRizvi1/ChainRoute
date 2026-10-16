import json
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from allocator import ALGORITHM, build_allocation_plan
from models import AllocationPlan, OptimizeRequest
from synthetic_data import SYNTHETIC_START, generate_dataset

ROOT = Path(__file__).resolve().parent.parent
WEIGHTS = {"onTime": 0.5, "cost": 0.3, "utilization": 0.2}


def make_request(
    orders: list[dict],
    wagons: list[dict],
    routes: list[dict],
) -> OptimizeRequest:
    return OptimizeRequest.model_validate(
        {"orders": orders, "wagons": wagons, "routes": routes, "weights": WEIGHTS}
    )


def order(
    order_id: str,
    *,
    cargo: str = "grain",
    quantity: float = 20,
    destination: str = "Port-A",
    priority: int = 1,
    deadline: datetime | None = None,
) -> dict:
    return {
        "orderId": order_id,
        "cargoType": cargo,
        "quantityTonnes": quantity,
        "destination": destination,
        "priority": priority,
        "deadline": (deadline or SYNTHETIC_START + timedelta(days=2)).isoformat(),
    }


def wagon(
    wagon_id: str,
    *,
    wagon_type: str = "covered",
    capacity: float = 20,
    location: str = "Yard-0",
    available: bool = True,
) -> dict:
    return {
        "wagonId": wagon_id,
        "capacityTonnes": capacity,
        "wagonType": wagon_type,
        "location": location,
        "available": available,
    }


def route(
    route_id: str = "RTE-1",
    *,
    origin: str = "Yard-0",
    destination: str = "Port-A",
    distance: float = 120,
    transit_seconds: int = 3600,
) -> dict:
    return {
        "routeId": route_id,
        "origin": origin,
        "destination": destination,
        "distanceKm": distance,
        "transitTimeSeconds": transit_seconds,
    }


class AllocationInvariantTests(unittest.TestCase):
    def test_all_generated_scenarios_preserve_allocation_invariants(self) -> None:
        for seed in range(50):
            for scenario in ("plentiful", "scarce"):
                dataset = generate_dataset(25, seed, scenario)
                request = make_request(
                    dataset["orders"],
                    dataset["wagons"],
                    dataset["routes"],
                )
                plan = build_allocation_plan(request)
                by_order = {item["orderId"]: item for item in plan["assignments"]}
                unassigned_ids = {
                    item["orderId"] for item in plan["unassignedOrders"]
                }
                all_order_ids = {item.orderId for item in request.orders}
                with self.subTest(seed=seed, scenario=scenario):
                    self.assertEqual(set(by_order) | unassigned_ids, all_order_ids)
                    self.assertFalse(set(by_order) & unassigned_ids)
                    self.assertEqual(
                        len(by_order) + len(unassigned_ids), len(all_order_ids)
                    )
                    wagon_by_id = {item.wagonId: item for item in request.wagons}
                    used_wagons = [
                        wagon_id
                        for assignment in by_order.values()
                        for wagon_id in assignment["wagonIds"]
                    ]
                    self.assertEqual(len(used_wagons), len(set(used_wagons)))
                    for assignment in by_order.values():
                        assigned_order = next(
                            item
                            for item in request.orders
                            if item.orderId == assignment["orderId"]
                        )
                        assigned_wagons = [
                            wagon_by_id[wagon_id]
                            for wagon_id in assignment["wagonIds"]
                        ]
                        selected_route = next(
                            item
                            for item in request.routes
                            if item.routeId == assignment["route"]["routeId"]
                        )
                        self.assertTrue(
                            all(item.available for item in assigned_wagons)
                        )
                        self.assertTrue(
                            all(
                                item.location == selected_route.origin
                                for item in assigned_wagons
                            )
                        )
                        self.assertGreaterEqual(
                            sum(item.capacityTonnes for item in assigned_wagons),
                            assigned_order.quantityTonnes,
                        )
                        self.assertEqual(
                            selected_route.destination, assigned_order.destination
                        )
                        self.assertEqual(
                            assignment["route"]["origin"], selected_route.origin
                        )
                        self.assertLessEqual(
                            datetime.fromisoformat(assignment["eta"]),
                            assigned_order.deadline,
                        )
                    AllocationPlan.model_validate_json(json.dumps(plan))

    def test_sample_request_gets_valid_plan_and_correct_wagon_assignments(self) -> None:
        payload = json.loads((ROOT / "samples" / "optimize-request.json").read_text())
        request = OptimizeRequest.model_validate(payload)
        plan = build_allocation_plan(request)
        by_order = {item["orderId"]: item for item in plan["assignments"]}
        self.assertEqual(len(plan["assignments"]), 5)
        self.assertEqual(plan["unassignedOrders"], [])
        self.assertEqual(
            by_order["ORD-0001"]["wagonIds"], ["WAG-001", "WAG-002"]
        )
        self.assertEqual(
            by_order["ORD-0002"]["wagonIds"], ["WAG-003", "WAG-004"]
        )
        self.assertEqual(
            by_order["ORD-0003"]["wagonIds"], ["WAG-005", "WAG-006"]
        )
        self.assertEqual(
            by_order["ORD-0004"]["wagonIds"], ["WAG-007", "WAG-008"]
        )
        self.assertEqual(
            by_order["ORD-0005"]["wagonIds"], ["WAG-009", "WAG-010"]
        )
        self.assertEqual(plan["runMetadata"]["algorithm"], ALGORITHM)
        self.assertTrue(plan["runMetadata"]["inputHash"].startswith("sha256:"))
        self.assertEqual(plan["runMetadata"]["prediction"], {
            "method": "heuristic_fallback",
            "modelVersion": None,
        })
        AllocationPlan.model_validate_json(json.dumps(plan))

    def test_assignments_are_deterministic_even_when_request_order_changes(self) -> None:
        request = make_request(
            [
                order("ORD-B", priority=2),
                order("ORD-C", priority=3),
                order("ORD-A", priority=1),
            ],
            [wagon("WAG-1", capacity=20)],
            [route()],
        )
        first = build_allocation_plan(request)
        shuffled = request.model_copy(
            update={"orders": list(reversed(request.orders))}
        )
        second = build_allocation_plan(shuffled)
        self.assertEqual(first["assignments"], second["assignments"])
        self.assertEqual(first["unassignedOrders"], second["unassignedOrders"])
        self.assertNotEqual(first["runId"], second["runId"])
        self.assertNotEqual(first["planId"], second["planId"])
        repeated = build_allocation_plan(request)
        self.assertEqual(
            first["runMetadata"]["inputHash"],
            repeated["runMetadata"]["inputHash"],
        )


class AllocationEdgeCaseTests(unittest.TestCase):
    def test_no_matching_route_is_reported(self) -> None:
        plan = build_allocation_plan(
            make_request([order("ORD-1")], [wagon("WAG-1")], [])
        )
        self.assertEqual(plan["unassignedOrders"][0]["reasonCode"], "NO_ROUTE")
        self.assertEqual(plan["assignments"], [])

    def test_no_compatible_wagon_is_reported(self) -> None:
        plan = build_allocation_plan(
            make_request(
                [order("ORD-1")],
                [wagon("WAG-1", wagon_type="open")],
                [route()],
            )
        )
        self.assertEqual(
            plan["unassignedOrders"][0]["reasonCode"], "NO_COMPATIBLE_WAGON"
        )

    def test_capacity_shortage_reports_insufficient_capacity(self) -> None:
        plan = build_allocation_plan(
            make_request(
                [order("ORD-1", quantity=40)],
                [wagon("WAG-1", capacity=20)],
                [route()],
            )
        )
        self.assertEqual(
            plan["unassignedOrders"][0]["reasonCode"], "INSUFFICIENT_CAPACITY"
        )

    def test_unavailable_wagons_are_not_used(self) -> None:
        plan = build_allocation_plan(
            make_request(
                [order("ORD-1")],
                [wagon("WAG-1", available=False)],
                [route()],
            )
        )
        self.assertEqual(plan["assignments"], [])
        self.assertEqual(
            plan["unassignedOrders"][0]["reasonCode"], "INSUFFICIENT_CAPACITY"
        )

    def test_all_wagons_unavailable_returns_schema_valid_empty_plan(self) -> None:
        plan = build_allocation_plan(
            make_request(
                [order("ORD-1"), order("ORD-2")],
                [wagon("WAG-1", available=False)],
                [route()],
            )
        )
        self.assertEqual(plan["assignments"], [])
        self.assertEqual(len(plan["unassignedOrders"]), 2)
        self.assertTrue(
            all(
                item["reasonCode"] == "INSUFFICIENT_CAPACITY"
                for item in plan["unassignedOrders"]
            )
        )
        self.assertEqual(plan["metrics"]["utilizationPercent"], 0)
        AllocationPlan.model_validate_json(json.dumps(plan))

    def test_priority_deadline_and_id_break_capacity_ties_deterministically(self) -> None:
        request = make_request(
            [
                order("ORD-Z", priority=1),
                order("ORD-B", priority=2),
                order("ORD-A", priority=1),
            ],
            [wagon("WAG-1")],
            [route()],
        )
        plan = build_allocation_plan(request)
        self.assertEqual(
            [item["orderId"] for item in plan["assignments"]], ["ORD-A"]
        )
        self.assertEqual(
            {item["orderId"] for item in plan["unassignedOrders"]},
            {"ORD-B", "ORD-Z"},
        )

    def test_earlier_deadline_precedes_id_within_priority(self) -> None:
        earlier_deadline = SYNTHETIC_START + timedelta(hours=2)
        later_deadline = SYNTHETIC_START + timedelta(days=2)
        plan = build_allocation_plan(
            make_request(
                [
                    order("ORD-A", deadline=later_deadline),
                    order("ORD-Z", deadline=earlier_deadline),
                ],
                [wagon("WAG-1")],
                [route()],
            )
        )
        self.assertEqual(plan["assignments"][0]["orderId"], "ORD-Z")

    def test_route_ties_use_shortest_distance_then_route_id(self) -> None:
        plan = build_allocation_plan(
            make_request(
                [order("ORD-1")],
                [wagon("WAG-1", location="Yard-A"), wagon("WAG-2", location="Yard-B")],
                [
                    route("RTE-Z", origin="Yard-A", distance=100),
                    route("RTE-B", origin="Yard-B", distance=50),
                    route("RTE-A", origin="Yard-B", distance=50),
                ],
            )
        )
        self.assertEqual(plan["assignments"][0]["route"]["routeId"], "RTE-A")
        self.assertEqual(plan["assignments"][0]["wagonIds"], ["WAG-2"])

    def test_alternate_route_is_used_when_shortest_route_misses_deadline(self) -> None:
        deadline = SYNTHETIC_START + timedelta(hours=2)
        plan = build_allocation_plan(
            make_request(
                [order("ORD-1", deadline=deadline)],
                [wagon("WAG-1", location="Yard-A"), wagon("WAG-2", location="Yard-B")],
                [
                    route("RTE-SLOW", origin="Yard-A", distance=10, transit_seconds=10_000),
                    route("RTE-FAST", origin="Yard-B", distance=20, transit_seconds=3_600),
                ],
            )
        )
        self.assertEqual(plan["assignments"][0]["route"]["routeId"], "RTE-FAST")

    def test_deadline_impossible_is_reported(self) -> None:
        plan = build_allocation_plan(
            make_request(
                [
                    order(
                        "ORD-1",
                        deadline=SYNTHETIC_START + timedelta(minutes=30),
                    )
                ],
                [wagon("WAG-1")],
                [route(transit_seconds=3600)],
            )
        )
        self.assertEqual(
            plan["unassignedOrders"][0]["reasonCode"], "NO_FEASIBLE_ASSIGNMENT"
        )

    def test_empty_order_set_returns_valid_empty_plan(self) -> None:
        plan = build_allocation_plan(
            make_request([], [wagon("WAG-1")], [route()])
        )
        self.assertEqual(plan["assignments"], [])
        self.assertEqual(plan["unassignedOrders"], [])
        self.assertEqual(plan["metrics"]["utilizationPercent"], 0)
        AllocationPlan.model_validate_json(json.dumps(plan))

    def test_unknown_synthetic_cargo_is_not_assigned(self) -> None:
        plan = build_allocation_plan(
            make_request(
                [order("ORD-1", cargo="lithium")],
                [wagon("WAG-1", wagon_type="covered")],
                [route()],
            )
        )
        self.assertEqual(
            plan["unassignedOrders"][0]["reasonCode"], "NO_COMPATIBLE_WAGON"
        )


if __name__ == "__main__":
    unittest.main()
