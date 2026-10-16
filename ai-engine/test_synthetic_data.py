import json
import unittest
from datetime import datetime
from pathlib import Path

from synthetic_data import (
    BASE_LOCATION,
    CARGO_TO_WAGON,
    DESTINATION_ROUTES,
    SYNTHETIC_START,
    generate_dataset,
    validate_master_data,
    validate_orders,
)


class SyntheticDatasetTests(unittest.TestCase):
    def test_saved_samples_match_default_generator_output(self) -> None:
        sample_directory = Path(__file__).resolve().parent.parent / "samples"
        for scenario in ("plentiful", "scarce"):
            expected = (
                json.dumps(
                    generate_dataset(25, 1, scenario),
                    indent=2,
                    ensure_ascii=False,
                )
                + "\n"
            ).encode()
            actual = (sample_directory / f"{scenario}-dataset.json").read_bytes()
            with self.subTest(scenario=scenario):
                self.assertEqual(actual, expected)

    def test_generation_is_byte_identical_for_same_seed(self) -> None:
        first = json.dumps(
            generate_dataset(25, 1, "plentiful"),
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        second = json.dumps(
            generate_dataset(25, 1, "plentiful"),
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        self.assertEqual(first, second)

    def test_different_seeds_produce_different_datasets(self) -> None:
        self.assertNotEqual(
            generate_dataset(25, 1, "plentiful"),
            generate_dataset(25, 2, "plentiful"),
        )

    def test_scenarios_share_orders_and_routes_for_fair_comparison(self) -> None:
        plentiful = generate_dataset(25, 1, "plentiful")
        scarce = generate_dataset(25, 1, "scarce")
        self.assertEqual(plentiful["orders"], scarce["orders"])
        self.assertEqual(plentiful["routes"], scarce["routes"])
        self.assertNotEqual(plentiful["wagons"], scarce["wagons"])

    def test_order_count_and_generated_fields(self) -> None:
        dataset = generate_dataset(25, 1, "plentiful")
        self.assertEqual(len(dataset["orders"]), 25)
        for order in dataset["orders"]:
            self.assertIn(order["priority"], (1, 2, 3))
            self.assertGreater(order["quantityTonnes"], 0)
            self.assertIn(order["cargoType"], CARGO_TO_WAGON)

    def test_every_order_destination_has_a_route(self) -> None:
        dataset = generate_dataset(25, 1, "plentiful")
        route_destinations = {route["destination"] for route in dataset["routes"]}
        self.assertTrue(
            all(order["destination"] in route_destinations for order in dataset["orders"])
        )
        self.assertTrue(all(route["origin"] == BASE_LOCATION for route in dataset["routes"]))

    def test_plentiful_and_scarce_capacity_targets(self) -> None:
        for seed in range(50):
            plentiful = generate_dataset(25, seed, "plentiful")
            scarce = generate_dataset(25, seed, "scarce")
            plentiful_demand = sum(
                order["quantityTonnes"] for order in plentiful["orders"]
            )
            scarce_demand = sum(order["quantityTonnes"] for order in scarce["orders"])
            plentiful_capacity = sum(
                wagon["capacityTonnes"]
                for wagon in plentiful["wagons"]
                if wagon["available"]
            )
            scarce_capacity = sum(
                wagon["capacityTonnes"]
                for wagon in scarce["wagons"]
                if wagon["available"]
            )
            self.assertGreaterEqual(plentiful_capacity, 1.2 * plentiful_demand)
            self.assertLessEqual(scarce_capacity, 0.6 * scarce_demand)

    def test_generated_records_pass_batch_validation(self) -> None:
        for seed in range(50):
            for scenario in ("plentiful", "scarce"):
                dataset = generate_dataset(25, seed, scenario)
                order_result = validate_orders(dataset["orders"])
                master_result = validate_master_data(
                    dataset["wagons"], dataset["routes"]
                )
                with self.subTest(seed=seed, scenario=scenario):
                    self.assertEqual(order_result["rejected"], [])
                    self.assertEqual(master_result["wagons"]["rejected"], [])
                    self.assertEqual(master_result["routes"]["rejected"], [])

    def test_plentiful_wagons_match_cargo_compatibility(self) -> None:
        dataset = generate_dataset(25, 1, "plentiful")
        expected_capacity = {
            wagon_type: 0 for wagon_type in CARGO_TO_WAGON.values()
        }
        actual_capacity = {
            wagon_type: 0 for wagon_type in CARGO_TO_WAGON.values()
        }
        for order in dataset["orders"]:
            expected_capacity[CARGO_TO_WAGON[order["cargoType"]]] += (
                order["quantityTonnes"]
            )
        for wagon in dataset["wagons"]:
            if wagon["available"]:
                actual_capacity[wagon["wagonType"]] += wagon["capacityTonnes"]
        for wagon_type, demand in expected_capacity.items():
            self.assertGreaterEqual(actual_capacity[wagon_type], 1.2 * demand)

    def test_deadlines_include_comfortable_tight_and_impossible_cases(self) -> None:
        dataset = generate_dataset(25, 1, "plentiful")
        observed_bands = set()
        route_by_destination = {
            route["destination"]: route for route in dataset["routes"]
        }
        for order in dataset["orders"]:
            deadline = datetime.fromisoformat(order["deadline"].replace("Z", "+00:00"))
            transit = route_by_destination[order["destination"]]["transitTimeSeconds"]
            deadline_offset = int((deadline - SYNTHETIC_START).total_seconds())
            if deadline_offset - transit == 86_400:
                observed_bands.add("comfortable")
            elif deadline_offset - transit == -3_600:
                observed_bands.add("tight")
            elif deadline_offset == 300:
                observed_bands.add("impossible")
        self.assertEqual(observed_bands, {"comfortable", "tight", "impossible"})

    def test_empty_generation_is_valid(self) -> None:
        dataset = generate_dataset(0, 1, "scarce")
        self.assertEqual(dataset["orders"], [])
        self.assertEqual(dataset["wagons"], [])
        self.assertEqual(len(dataset["routes"]), len(DESTINATION_ROUTES))

    def test_invalid_generation_arguments_are_rejected(self) -> None:
        invalid_arguments = (
            (-1, 1, "plentiful"),
            (True, 1, "plentiful"),
            (1, True, "scarce"),
            (1, 1, "unknown"),
        )
        for args in invalid_arguments:
            with self.subTest(args=args), self.assertRaises(ValueError):
                generate_dataset(*args)


class OrderValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.valid_order = {
            "orderId": "ORD-1",
            "cargoType": "grain",
            "quantityTonnes": 40,
            "destination": "NoRoute-Yet",
            "priority": 1,
            "deadline": "2026-01-08T06:00:00Z",
        }

    def test_valid_records_are_kept_alongside_rejections(self) -> None:
        bad_order = {**self.valid_order, "orderId": "ORD-2", "quantityTonnes": -5}
        good_order = {**self.valid_order, "orderId": "ORD-3"}
        result = validate_orders([bad_order, good_order])
        self.assertEqual([order["orderId"] for order in result["valid"]], ["ORD-3"])
        self.assertEqual(result["rejected"], [{"id": "ORD-2", "reason": "BAD_QUANTITY"}])

    def test_negative_quantity_has_bad_quantity_reason(self) -> None:
        result = validate_orders([{**self.valid_order, "quantityTonnes": -5}])
        self.assertEqual(result["rejected"][0]["reason"], "BAD_QUANTITY")

    def test_priority_out_of_range_is_rejected(self) -> None:
        result = validate_orders([{**self.valid_order, "priority": 9}])
        self.assertEqual(result["rejected"][0]["reason"], "BAD_PRIORITY")

    def test_missing_field_reason_names_field(self) -> None:
        order = dict(self.valid_order)
        order.pop("destination")
        result = validate_orders([order])
        self.assertEqual(result["rejected"][0]["reason"], "MISSING_FIELD:destination")

    def test_bad_deadline_is_rejected(self) -> None:
        result = validate_orders([{**self.valid_order, "deadline": "not-a-date"}])
        self.assertEqual(result["rejected"][0]["reason"], "BAD_DEADLINE")

    def test_unroutable_order_is_still_valid(self) -> None:
        result = validate_orders([self.valid_order])
        self.assertEqual(len(result["valid"]), 1)
        self.assertEqual(result["rejected"], [])

    def test_unknown_fields_are_rejected(self) -> None:
        result = validate_orders([{**self.valid_order, "unexpected": True}])
        self.assertEqual(result["rejected"][0]["reason"], "UNKNOWN_FIELD:unexpected")

    def test_second_duplicate_id_is_rejected(self) -> None:
        duplicate = {**self.valid_order, "destination": "Port-A"}
        result = validate_orders([self.valid_order, duplicate])
        self.assertEqual(len(result["valid"]), 1)
        self.assertEqual(result["rejected"], [{"id": "ORD-1", "reason": "DUPLICATE_ID"}])

    def test_empty_batch_is_valid(self) -> None:
        self.assertEqual(validate_orders([]), {"valid": [], "rejected": []})


class MasterDataValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.valid_wagon = {
            "wagonId": "WAG-1",
            "capacityTonnes": 20,
            "wagonType": "covered",
            "location": BASE_LOCATION,
            "available": True,
        }
        self.valid_route = {
            "routeId": "RTE-1",
            "origin": BASE_LOCATION,
            "destination": "Port-A",
            "distanceKm": 120,
            "transitTimeSeconds": 36_000,
        }

    def test_bad_wagon_and_route_do_not_discard_valid_records(self) -> None:
        result = validate_master_data(
            [
                {**self.valid_wagon, "wagonId": "WAG-BAD", "capacityTonnes": 0},
                self.valid_wagon,
                {**self.valid_wagon, "wagonId": "WAG-UNAVAILABLE", "available": False},
            ],
            [
                {**self.valid_route, "routeId": "RTE-BAD", "distanceKm": -1},
                self.valid_route,
            ],
        )
        self.assertEqual(len(result["wagons"]["valid"]), 2)
        self.assertFalse(result["wagons"]["valid"][1]["available"])
        self.assertEqual(
            result["wagons"]["rejected"],
            [{"id": "WAG-BAD", "reason": "BAD_CAPACITY"}],
        )
        self.assertEqual(len(result["routes"]["valid"]), 1)
        self.assertEqual(
            result["routes"]["rejected"],
            [{"id": "RTE-BAD", "reason": "BAD_DISTANCE"}],
        )

    def test_invalid_master_fields_have_field_specific_reasons(self) -> None:
        result = validate_master_data(
            [
                {**self.valid_wagon, "capacityTonnes": 0},
                {**self.valid_wagon, "wagonId": "WAG-2", "location": ""},
            ],
            [
                {**self.valid_route, "distanceKm": -1},
                {**self.valid_route, "routeId": "RTE-2", "transitTimeSeconds": 0},
            ],
        )
        self.assertEqual(
            [record["reason"] for record in result["wagons"]["rejected"]],
            ["BAD_CAPACITY", "EMPTY_FIELD:location"],
        )
        self.assertEqual(
            [record["reason"] for record in result["routes"]["rejected"]],
            ["BAD_DISTANCE", "BAD_TRANSIT_TIME"],
        )

    def test_duplicate_master_ids_reject_only_second_occurrence(self) -> None:
        result = validate_master_data(
            [self.valid_wagon, dict(self.valid_wagon)],
            [self.valid_route, dict(self.valid_route)],
        )
        self.assertEqual(len(result["wagons"]["valid"]), 1)
        self.assertEqual(
            result["wagons"]["rejected"],
            [{"id": "WAG-1", "reason": "DUPLICATE_ID"}],
        )
        self.assertEqual(len(result["routes"]["valid"]), 1)
        self.assertEqual(
            result["routes"]["rejected"],
            [{"id": "RTE-1", "reason": "DUPLICATE_ID"}],
        )


if __name__ == "__main__":
    unittest.main()
