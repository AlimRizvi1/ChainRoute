import unittest
from datetime import timedelta
from allocator import build_allocation_plan
from models import OptimizeRequest
from synthetic_data import SYNTHETIC_START


class OperationalClockTests(unittest.TestCase):
    def request(self, offset=timedelta(0), deadline_hours=2):
        return OptimizeRequest.model_validate({
            "orders": [{"orderId": "CLOCK-ORDER", "cargoType": "grain", "quantityTonnes": 20,
                        "destination": "Port-A", "priority": 1,
                        "deadline": (SYNTHETIC_START + offset + timedelta(hours=deadline_hours)).isoformat()}],
            "wagons": [{"wagonId": "CLOCK-WAGON", "capacityTonnes": 20, "wagonType": "covered", "location": "Yard-A", "available": True}],
            "routes": [{"routeId": "CLOCK-ROUTE", "origin": "Yard-A", "destination": "Port-A", "distanceKm": 10, "transitTimeSeconds": 3600}],
            "weights": {"onTime": 1, "cost": 1, "utilization": 1}, "timeBudgetSeconds": .05,
            **({"planningStart": (SYNTHETIC_START + offset).isoformat()} if offset else {}),
        })

    def test_real_dates_preserve_feasibility_metrics_and_prediction(self):
        offset = timedelta(days=320, hours=3)
        old = build_allocation_plan(self.request())
        current = build_allocation_plan(self.request(offset))
        self.assertEqual(old["metrics"], current["metrics"])
        self.assertEqual(current["assignments"][0]["departAt"], (SYNTHETIC_START + offset).isoformat())
        self.assertEqual(current["assignments"][0]["eta"], (SYNTHETIC_START + offset + timedelta(hours=1)).isoformat())
        self.assertEqual(old["assignments"][0]["onTimeProbability"], current["assignments"][0]["onTimeProbability"])

    def test_impossible_operational_deadline_is_not_hidden_by_synthetic_epoch(self):
        result = build_allocation_plan(self.request(timedelta(days=320), .5))
        self.assertEqual(result["assignments"], [])
        self.assertEqual(len(result["unassignedOrders"]), 1)

    def test_operational_clock_requires_explicit_utc(self):
        body = self.request().model_dump(mode="json")
        body["planningStart"] = "2026-10-26T12:00:00"
        with self.assertRaises(ValueError):
            OptimizeRequest.model_validate(body)


if __name__ == "__main__":
    unittest.main()
