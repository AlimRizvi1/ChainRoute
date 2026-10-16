import copy
import unittest
from datetime import timedelta

from allocator import build_allocation_plan
from models import Assignment, OptimizeRequest, Route, Wagon, Weights
from ranking import (
    COST_PAISE_PER_WAGON_KM,
    CandidatePlan,
    calculate_metrics,
    normalize_weights,
    rank_candidates,
)
from synthetic_data import SYNTHETIC_START


def candidate(
    signature: str,
    *,
    order_count: int = 1,
    on_time: float = 0.0,
    cost_paise: str = "0",
    utilization: float = 0.0,
) -> CandidatePlan:
    assignments = [
        {"orderId": f"ORD-{index}", "wagonIds": [], "route": {"routeId": "R"}}
        for index in range(order_count)
    ]
    return CandidatePlan(
        assignments=assignments,
        unassigned_orders=[],
        metrics={
            "utilizationPercent": utilization,
            "estimatedCostPaise": cost_paise,
            "distanceKm": 0.0,
            "onTimeProbability": on_time,
        },
        signature=signature,
    )


def assignment(
    order_id: str,
    wagon_ids: list[str],
    *,
    route_id: str = "RTE-1",
    quantity: float = 40,
    on_time: float = 0.8,
) -> Assignment:
    eta = SYNTHETIC_START + timedelta(hours=1)
    return Assignment(
        orderId=order_id,
        cargoType="grain",
        wagonIds=wagon_ids,
        route={
            "routeId": route_id,
            "origin": "Yard-0",
            "destination": "Port-A",
        },
        quantityTonnes=quantity,
        departAt=SYNTHETIC_START,
        eta=eta,
        onTimeProbability=on_time,
        score=on_time,
    )


def optimize_request(weights: dict[str, float]) -> OptimizeRequest:
    return OptimizeRequest.model_validate(
        {
            "orders": [
                {
                    "orderId": "ORD-1",
                    "cargoType": "grain",
                    "quantityTonnes": 20,
                    "destination": "Port-A",
                    "priority": 1,
                    "deadline": (
                        SYNTHETIC_START + timedelta(hours=3)
                    ).isoformat(),
                }
            ],
            "wagons": [
                {
                    "wagonId": "WAG-1",
                    "capacityTonnes": 20,
                    "wagonType": "covered",
                    "location": "Yard-0",
                    "available": True,
                }
            ],
            "routes": [
                {
                    "routeId": "RTE-SLOW-SHORT",
                    "origin": "Yard-0",
                    "destination": "Port-A",
                    "distanceKm": 10,
                    "transitTimeSeconds": 3600,
                },
                {
                    "routeId": "RTE-FAST-LONG",
                    "origin": "Yard-0",
                    "destination": "Port-A",
                    "distanceKm": 30,
                    "transitTimeSeconds": 1800,
                },
            ],
            "weights": weights,
        }
    )


class WeightAndRankingTests(unittest.TestCase):
    def test_on_time_and_cost_weights_select_the_expected_hand_built_plan(self) -> None:
        cheap = candidate(
            "A-cheap", on_time=0.6, cost_paise="100", utilization=50
        )
        timely = candidate(
            "B-timely", on_time=0.95, cost_paise="500", utilization=50
        )

        self.assertEqual(
            rank_candidates(
                [cheap, timely], Weights(onTime=1, cost=0, utilization=0), 1, 500
            )[0].signature,
            "B-timely",
        )
        self.assertEqual(
            rank_candidates(
                [cheap, timely], Weights(onTime=0, cost=1, utilization=0), 1, 500
            )[0].signature,
            "A-cheap",
        )

    def test_equal_and_zero_weights_are_deterministic_equal_thirds(self) -> None:
        options = [
            candidate("B", on_time=0.9, cost_paise="100", utilization=70),
            candidate("A", on_time=0.9, cost_paise="100", utilization=70),
        ]
        all_equal = Weights(onTime=1, cost=1, utilization=1)
        all_zero = Weights(onTime=0, cost=0, utilization=0)
        self.assertEqual(
            normalize_weights(all_zero),
            normalize_weights(all_equal),
        )
        self.assertEqual(
            [item.signature for item in rank_candidates(options, all_equal, 1, 100)],
            ["A", "B"],
        )
        self.assertEqual(
            [item.signature for item in rank_candidates(options, all_equal, 1, 100)],
            [item.signature for item in rank_candidates(options, all_equal, 1, 100)],
        )
        self.assertEqual(
            [item.signature for item in rank_candidates(options, all_zero, 1, 100)],
            ["A", "B"],
        )

    def test_weight_scaling_does_not_change_ranking(self) -> None:
        options = [
            candidate("A", on_time=0.7, cost_paise="40", utilization=80),
            candidate("B", on_time=0.9, cost_paise="90", utilization=50),
            candidate("C", on_time=0.5, cost_paise="20", utilization=90),
        ]
        first = Weights(onTime=2, cost=1, utilization=1)
        scaled = Weights(onTime=0.5, cost=0.25, utilization=0.25)
        self.assertEqual(
            [item.signature for item in rank_candidates(options, first, 1, 100)],
            [item.signature for item in rank_candidates(options, scaled, 1, 100)],
        )

    def test_coverage_safeguard_prevents_cheap_partial_plan_from_winning(self) -> None:
        partial = candidate(
            "partial", order_count=1, on_time=1, cost_paise="0", utilization=100
        )
        full = candidate(
            "full",
            order_count=2,
            on_time=0,
            cost_paise="1000",
            utilization=0,
        )
        ranked = rank_candidates(
            [partial, full],
            Weights(onTime=0, cost=1, utilization=0),
            order_count=2,
            maximum_cost_paise=1000,
        )
        self.assertEqual(ranked[0].signature, "full")

    def test_duplicate_candidates_are_removed_and_ties_use_signature(self) -> None:
        options = [candidate("z"), candidate("a"), candidate("a")]
        ranked = rank_candidates(
            options, Weights(onTime=1, cost=1, utilization=1), 1, 100
        )
        self.assertEqual([item.signature for item in ranked], ["a", "z"])

    def test_negative_weights_are_rejected_by_request_validation(self) -> None:
        with self.assertRaises(ValueError):
            Weights(onTime=-0.1, cost=1, utilization=1)

    def test_large_finite_weights_normalize_without_overflow(self) -> None:
        weights = Weights(
            onTime=1e308,
            cost=1e308,
            utilization=1e308,
        )
        self.assertEqual(
            normalize_weights(weights),
            {"onTime": 1 / 3, "cost": 1 / 3, "utilization": 1 / 3},
        )
        with self.assertRaises(ValueError):
            Weights(onTime=float("inf"), cost=1, utilization=1)


class MetricTests(unittest.TestCase):
    def test_hand_computed_utilization_distance_and_cost(self) -> None:
        wagons = [
            Wagon(
                wagonId=f"WAG-{index}",
                capacityTonnes=20,
                wagonType="covered",
                location="Yard-0",
                available=True,
            )
            for index in range(1, 4)
        ]
        routes = [
            Route(
                routeId="RTE-1",
                origin="Yard-0",
                destination="Port-A",
                distanceKm=100,
                transitTimeSeconds=3600,
            )
        ]
        metrics = calculate_metrics(
            [assignment("ORD-1", ["WAG-1", "WAG-2", "WAG-3"])],
            order_count=1,
            wagons=wagons,
            routes=routes,
        )
        self.assertAlmostEqual(metrics["utilizationPercent"], 100 * 40 / 60)
        self.assertEqual(metrics["estimatedCostPaise"], "75000")
        self.assertEqual(
            metrics["estimatedCostPaise"],
            str(3 * 100 * COST_PAISE_PER_WAGON_KM),
        )
        self.assertEqual(metrics["distanceKm"], 100)

    def test_empty_candidate_metrics_are_zero(self) -> None:
        metrics = calculate_metrics([], 1, [], [])
        self.assertEqual(metrics, {
            "utilizationPercent": 0.0,
            "estimatedCostPaise": "0",
            "distanceKm": 0,
            "onTimeProbability": 0.0,
        })


class OptimizerRankingTests(unittest.TestCase):
    def test_what_if_weights_change_selected_route_without_mutating_first_result(self) -> None:
        on_time_request = optimize_request(
            {"onTime": 1, "cost": 0, "utilization": 0}
        )
        first = build_allocation_plan(on_time_request)
        first_snapshot = copy.deepcopy(first)
        cost_plan = build_allocation_plan(
            optimize_request({"onTime": 0, "cost": 1, "utilization": 0})
        )

        self.assertEqual(
            first["assignments"][0]["route"]["routeId"], "RTE-FAST-LONG"
        )
        self.assertEqual(
            cost_plan["assignments"][0]["route"]["routeId"], "RTE-SLOW-SHORT"
        )
        self.assertNotEqual(first["runId"], cost_plan["runId"])
        self.assertNotEqual(first["planId"], cost_plan["planId"])
        self.assertEqual(first, first_snapshot)

    def test_alternatives_are_distinct_ranked_and_limited(self) -> None:
        request = optimize_request({"onTime": 1, "cost": 1, "utilization": 1})
        plan = build_allocation_plan(request)
        alternatives = plan["alternatives"]
        self.assertLessEqual(len(alternatives), 3)
        signatures = [
            (
                tuple(item["orderId"] for item in candidate["assignments"]),
                tuple(
                    assignment_item["route"]["routeId"]
                    for assignment_item in candidate["assignments"]
                ),
                tuple(
                    tuple(sorted(assignment_item["wagonIds"]))
                    for assignment_item in candidate["assignments"]
                ),
            )
            for candidate in [
                {
                    "assignments": plan["assignments"],
                    "metrics": plan["metrics"],
                    "score": plan["score"],
                },
                *alternatives,
            ]
        ]
        self.assertEqual(len(signatures), len(set(signatures)))
        self.assertEqual(
            [item["rank"] for item in alternatives],
            list(range(1, len(alternatives) + 1)),
        )
        self.assertEqual(
            [plan["score"], *(item["score"] for item in alternatives)],
            sorted(
                [plan["score"], *(item["score"] for item in alternatives)],
                reverse=True,
            ),
        )

    def test_single_unique_candidate_has_no_alternatives_and_empty_plan_has_score(self) -> None:
        request = optimize_request({"onTime": 0, "cost": 0, "utilization": 0})
        request.routes = [request.routes[0]]
        plan = build_allocation_plan(request)
        self.assertEqual(plan["alternatives"], [])
        self.assertGreaterEqual(plan["score"], 0)


if __name__ == "__main__":
    unittest.main()
