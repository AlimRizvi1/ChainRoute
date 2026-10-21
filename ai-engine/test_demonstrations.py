import unittest
from pydantic import ValidationError
from demonstrations import DemonstrationRequest, run_demonstration


class DemonstrationsTests(unittest.TestCase):
    def test_cp_sat_resolves_the_greedy_bottleneck(self):
        result = run_demonstration(DemonstrationRequest(kind="cp-sat"))
        self.assertTrue(result["synthetic"])
        self.assertEqual(len(result["baseline"]["assignments"]), 1)
        assignments = result["plan"]["assignments"]
        self.assertEqual(len(assignments), 2)
        by_order = {item["orderId"]: item["wagonIds"] for item in assignments}
        self.assertEqual(by_order, {"ORD-FLEX": ["WAG-A"], "ORD-ONLY": ["WAG-B"]})

    def test_live_ml_increases_with_slack_and_uses_the_model(self):
        probabilities = []
        for slack in (0.0, 0.25, 0.5):
            result = run_demonstration(DemonstrationRequest(kind="ml", slackRatio=slack))
            self.assertIsNone(result["baseline"])
            self.assertEqual(result["plan"]["runMetadata"]["prediction"]["method"], "logistic_regression")
            probabilities.append(result["plan"]["metrics"]["onTimeProbability"])
        self.assertTrue(0.5 < probabilities[0] < probabilities[1] < probabilities[2] < 0.99)

    def test_only_fixed_teaching_inputs_are_accepted(self):
        for payload in ({"kind": "other"}, {"kind": "ml", "slackRatio": 10}, {"kind": "ml", "orders": []}):
            with self.assertRaises(ValidationError):
                DemonstrationRequest.model_validate(payload)


if __name__ == "__main__":
    unittest.main()
