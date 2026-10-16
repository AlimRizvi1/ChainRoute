import unittest
from dataclasses import replace
from datetime import timedelta
from time import perf_counter
from unittest.mock import patch

from models import Order, Route, Weights
from prediction import (
    apply_candidate_predictions,
    load_prediction_model,
    predict_or_fallback,
    predict_probability,
)
from ranking import CandidatePlan, rank_candidates
from synthetic_data import SYNTHETIC_START, generate_dataset


def make_order(slack_ratio: float, cargo_type: str = "grain") -> Order:
    transit_seconds = 3600
    deadline = SYNTHETIC_START + timedelta(
        seconds=transit_seconds * (1 + slack_ratio)
    )
    return Order.model_validate(
        {
            "orderId": "ORD-1",
            "cargoType": cargo_type,
            "quantityTonnes": 1.0,
            "destination": "Port-A",
            "priority": 1,
            "deadline": deadline.isoformat(),
        }
    )


def make_route(transit_seconds: int = 3600) -> Route:
    return Route.model_validate(
        {
            "routeId": "RTE-1",
            "origin": "Yard-0",
            "destination": "Port-A",
            "distanceKm": 100.0,
            "transitTimeSeconds": transit_seconds,
        }
    )


class PredictionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.model = load_prediction_model()
        if cls.model is None:
            raise AssertionError("Expected the checked-in trained model artifact")

    def test_held_out_accuracy_meets_recorded_tolerance(self) -> None:
        self.assertLessEqual(self.model.held_out_mae, 0.10)

    def test_huge_slack_and_deficit_reach_probability_boundaries(self) -> None:
        route = make_route()
        on_time = predict_probability(self.model, make_order(100.0), route)
        late = predict_probability(self.model, make_order(-100.0), route)
        self.assertIsNotNone(on_time)
        self.assertIsNotNone(late)
        self.assertGreater(on_time, 0.99)
        self.assertLess(late, 0.01)

    def test_more_slack_never_reduces_probability(self) -> None:
        route = make_route()
        probabilities = [
            predict_probability(self.model, make_order(ratio), route)
            for ratio in (-0.5, 0.0, 0.5, 2.0, 10.0)
        ]
        self.assertEqual(probabilities, sorted(probabilities))

    def test_inference_is_deterministic(self) -> None:
        order = make_order(1.5, "coal")
        route = make_route(7200)
        first = predict_probability(self.model, order, route)
        second = predict_probability(self.model, order, route)
        self.assertEqual(first, second)

    def test_unseen_cargo_uses_labelled_fallback(self) -> None:
        probability, method = predict_or_fallback(
            self.model, make_order(1.0, "bauxite"), make_route()
        )
        self.assertEqual(method, "heuristic_fallback")
        self.assertGreaterEqual(probability, 0.0)
        self.assertLessEqual(probability, 1.0)

    def test_corrupt_route_transit_is_rejected(self) -> None:
        route = make_route().model_copy(update={"transitTimeSeconds": -1})
        with self.assertRaisesRegex(ValueError, "transit time must be positive"):
            predict_probability(self.model, make_order(1.0), route)

    def test_300_predictions_take_a_small_fraction_of_a_second(self) -> None:
        dataset = generate_dataset(300, 42, "plentiful")
        routes_by_destination = {
            route["destination"]: Route.model_validate(route)
            for route in dataset["routes"]
        }
        orders = [Order.model_validate(order) for order in dataset["orders"]]
        started = perf_counter()
        probabilities = [
            predict_probability(
                self.model, order, routes_by_destination[order.destination]
            )
            for order in orders
        ]
        elapsed = perf_counter() - started
        self.assertLess(elapsed, 0.25)
        self.assertEqual(len(probabilities), 300)
        self.assertTrue(all(value is not None for value in probabilities))

    def test_learned_scores_can_change_on_time_weighted_ranking(self) -> None:
        grain_order = make_order(0.1, "grain")
        steel_order = make_order(0.1, "steel")
        route = make_route()
        fallback_grain, _ = predict_or_fallback(None, grain_order, route)
        fallback_steel, _ = predict_or_fallback(None, steel_order, route)
        self.assertEqual(fallback_grain, fallback_steel)
        learned_grain = predict_probability(self.model, grain_order, route)
        learned_steel = predict_probability(self.model, steel_order, route)
        self.assertGreater(learned_grain, learned_steel)

        def candidate(signature: str, probability: float) -> CandidatePlan:
            return CandidatePlan(
                assignments=[{"orderId": "ORD-1"}],
                unassigned_orders=[],
                metrics={
                    "onTimeProbability": probability,
                    "utilizationPercent": 50.0,
                    "estimatedCostPaise": "100",
                },
                signature=signature,
            )

        fallback_rank = rank_candidates(
            [
                candidate("a-steel", fallback_steel),
                candidate("b-grain", fallback_grain),
            ],
            weights=Weights(onTime=1.0, cost=0.0, utilization=0.0),
            order_count=1,
            maximum_cost_paise=100,
        )
        learned_rank = rank_candidates(
            [
                candidate("a-steel", learned_steel),
                candidate("b-grain", learned_grain),
            ],
            weights=Weights(onTime=1.0, cost=0.0, utilization=0.0),
            order_count=1,
            maximum_cost_paise=100,
        )
        self.assertEqual(fallback_rank[0].signature, "a-steel")
        self.assertEqual(learned_rank[0].signature, "b-grain")

    def test_mixed_model_and_fallback_predictions_are_reported(self) -> None:
        grain = make_order(0.5, "grain")
        steel = make_order(0.5, "steel")
        route = make_route()
        candidate = CandidatePlan(
            assignments=[
                {"orderId": "ORD-1", "route": {"routeId": "RTE-1"}},
                {"orderId": "ORD-2", "route": {"routeId": "RTE-1"}},
            ],
            unassigned_orders=[],
            metrics={"onTimeProbability": 0.0},
            signature="mixed",
        )
        partial_model = replace(
            self.model,
            cargo_variability={
                "grain": self.model.cargo_variability["grain"]
            },
        )
        with patch("prediction.load_prediction_model", return_value=partial_model):
            method, version = apply_candidate_predictions(
                [candidate],
                [
                    grain.model_copy(update={"orderId": "ORD-1"}),
                    steel.model_copy(update={"orderId": "ORD-2"}),
                ],
                [route],
            )
        self.assertEqual(method, "mixed")
        self.assertEqual(version, self.model.model_version)
        self.assertEqual(len(candidate.assignments), 2)
        self.assertGreater(candidate.metrics["onTimeProbability"], 0.0)
