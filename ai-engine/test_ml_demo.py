import json
import tempfile
import unittest
from pathlib import Path

from demonstrate_ml import demo_request, evaluate_model
from models import Order, Route
from prediction import MODEL_PATH, load_prediction_model, predict_probability
from train_prediction_model import train_model


class ModelDemonstrationTests(unittest.TestCase):
    def test_frozen_evaluation_reproduces_artifact_and_accounts_for_every_sample(self):
        result = evaluate_model()
        artifact = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
        self.assertEqual(result["modelVersion"], artifact["modelVersion"])
        self.assertEqual(result["trainingDataHash"], artifact["trainingDataHash"])
        self.assertEqual((result["trainingSamples"], result["testSamples"]), (24_000, 6_000))
        self.assertAlmostEqual(result["probabilityMae"], artifact["training"]["heldOutMae"], places=9)
        self.assertAlmostEqual(result["brierScore"], artifact["training"]["heldOutBrierScore"], places=9)
        matrix = result["confusionMatrix"]
        self.assertEqual(sum(matrix.values()), 6_000)
        self.assertEqual(result["accuracy"], (matrix["trueOnTime"] + matrix["trueLate"]) / 6_000)
        self.assertEqual(result["alwaysOnTimeAccuracy"], (matrix["trueOnTime"] + matrix["falseLate"]) / 6_000)
        self.assertEqual(result["lateRecall"], matrix["trueLate"] / (matrix["trueLate"] + matrix["falseOnTime"]))

    def test_retraining_preserves_dataset_and_numerical_fit(self):
        with tempfile.TemporaryDirectory() as directory:
            trained = train_model(Path(directory) / "model.json")
            repeated = train_model(Path(directory) / "repeated.json")
        self.assertEqual(trained, repeated)
        artifact = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
        self.assertEqual(trained["trainingDataHash"], artifact["trainingDataHash"])
        # BLAS/scipy/platform changes can alter final float bits and the content hash.
        self.assertAlmostEqual(trained["intercept"], artifact["intercept"], places=10)
        for actual, recorded in zip(trained["coefficients"], artifact["coefficients"]):
            self.assertAlmostEqual(actual, recorded, places=10)
        for metric in ("heldOutMae", "heldOutBrierScore"):
            self.assertAlmostEqual(trained["training"][metric], artifact["training"][metric], places=10)

    def test_demo_deadlines_and_cargo_reach_real_model_without_saturation(self):
        model = load_prediction_model()
        for cargo in ("grain", "coal", "steel"):
            probabilities = []
            for slack in (0.0, 0.25, 0.5):
                request = demo_request(slack, cargo)
                order = Order.model_validate(request["orders"][0])
                route = Route.model_validate(request["routes"][0])
                probabilities.append(predict_probability(model, order, route))
            self.assertTrue(0.50 < probabilities[0] < probabilities[1] < probabilities[2] < 0.99)


if __name__ == "__main__":
    unittest.main()
