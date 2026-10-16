import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from time import perf_counter
from unittest.mock import patch

from fastapi.testclient import TestClient

from allocator import build_allocation_plan
from app import app
from models import OptimizeRequest
from run_log import get_run_record, write_run_record
from synthetic_data import generate_dataset


def request_payload(
    *,
    weight: float = 1.0,
    deadline: str = "2026-01-09T00:00:00Z",
) -> dict:
    return {
        "orders": [
            {
                "orderId": "ORD-1",
                "cargoType": "grain",
                "quantityTonnes": 1,
                "destination": "Port-A",
                "priority": 1,
                "deadline": deadline,
            }
        ],
        "wagons": [
            {
                "wagonId": "WAG-1",
                "capacityTonnes": 2,
                "wagonType": "covered",
                "location": "Yard-0",
                "available": True,
            }
        ],
        "routes": [
            {
                "routeId": "RTE-1",
                "origin": "Yard-0",
                "destination": "Port-A",
                "distanceKm": 10,
                "transitTimeSeconds": 3600,
            }
        ],
        "weights": {"onTime": weight, "cost": 0, "utilization": 0},
        "timeBudgetSeconds": 0.05,
    }


class RunLogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_directory = tempfile.TemporaryDirectory()
        self.database = Path(self.temp_directory.name) / "runs.sqlite3"
        self.path_patch = patch("run_log.RUN_LOG_PATH", self.database)
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)
        self.addCleanup(self.temp_directory.cleanup)

    def test_successful_run_has_complete_snapshot_and_retrieves_once(self) -> None:
        request = OptimizeRequest.model_validate(request_payload())
        plan = build_allocation_plan(request)
        record = get_run_record(plan["runId"])

        self.assertIsNotNone(record)
        self.assertEqual(record["status"], "succeeded")
        self.assertEqual(record["runId"], plan["runId"])
        self.assertEqual(record["planId"], plan["planId"])
        self.assertEqual(record["inputHash"], plan["runMetadata"]["inputHash"])
        self.assertEqual(record["inputSnapshot"], request.model_dump(mode="json"))
        self.assertEqual(record["inputCounts"], {"orders": 1, "wagons": 1, "routes": 1})
        self.assertEqual(record["parameters"]["weights"], request.weights.model_dump())
        self.assertEqual(record["parameters"]["timeBudgetSeconds"], 0.05)
        self.assertEqual(record["prediction"], plan["runMetadata"]["prediction"])
        self.assertIsNone(record["failure"])

        with closing(sqlite3.connect(self.database)) as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM optimization_runs WHERE run_id = ?",
                (plan["runId"],),
            ).fetchone()[0]
        self.assertEqual(count, 1)

    def test_identical_inputs_have_stable_hash_and_distinct_run_ids(self) -> None:
        request = OptimizeRequest.model_validate(request_payload())
        first = build_allocation_plan(request)
        second = build_allocation_plan(request)
        self.assertEqual(first["runMetadata"]["inputHash"], second["runMetadata"]["inputHash"])
        self.assertNotEqual(first["runId"], second["runId"])
        self.assertIsNotNone(get_run_record(first["runId"]))
        self.assertIsNotNone(get_run_record(second["runId"]))

    def test_input_changes_and_what_if_weights_create_distinct_complete_runs(self) -> None:
        first = build_allocation_plan(
            OptimizeRequest.model_validate(request_payload(weight=1))
        )
        what_if = build_allocation_plan(
            OptimizeRequest.model_validate(request_payload(weight=0.5))
        )
        changed_order = build_allocation_plan(
            OptimizeRequest.model_validate(
                request_payload(deadline="2026-01-10T00:00:00Z")
            )
        )

        self.assertNotEqual(
            first["runMetadata"]["inputHash"],
            what_if["runMetadata"]["inputHash"],
        )
        self.assertNotEqual(
            first["runMetadata"]["inputHash"],
            changed_order["runMetadata"]["inputHash"],
        )
        self.assertNotEqual(first["runId"], what_if["runId"])
        self.assertNotEqual(first["planId"], what_if["planId"])
        self.assertNotEqual(
            first["runMetadata"]["weights"], what_if["runMetadata"]["weights"]
        )
        for plan in (first, what_if, changed_order):
            self.assertIsNotNone(get_run_record(plan["runId"]))

    def test_prediction_failure_is_logged_before_error_is_raised(self) -> None:
        request = OptimizeRequest.model_validate(request_payload())
        with patch(
            "allocator.apply_candidate_predictions",
            side_effect=RuntimeError("model inference failed"),
        ):
            with self.assertRaisesRegex(RuntimeError, "model inference failed"):
                build_allocation_plan(request)

        with closing(sqlite3.connect(self.database)) as connection:
            rows = connection.execute(
                "SELECT record_json FROM optimization_runs"
            ).fetchall()
        self.assertEqual(len(rows), 1)
        record = json.loads(rows[0][0])
        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["failure"]["stage"], "prediction")
        self.assertEqual(record["failure"]["type"], "RuntimeError")
        self.assertIn("model inference failed", record["failure"]["message"])
        self.assertIsNone(get_run_record(record["runId"])["planId"])

    def test_failure_after_prediction_keeps_model_trace(self) -> None:
        request = OptimizeRequest.model_validate(request_payload())
        with patch(
            "allocator.rank_candidates",
            side_effect=RuntimeError("ranking failed"),
        ):
            with self.assertRaisesRegex(RuntimeError, "ranking failed"):
                build_allocation_plan(request)

        with closing(sqlite3.connect(self.database)) as connection:
            serialized = connection.execute(
                "SELECT record_json FROM optimization_runs"
            ).fetchone()[0]
        record = json.loads(serialized)
        self.assertEqual(record["failure"]["stage"], "scoring_and_ranking")
        self.assertEqual(record["prediction"]["method"], "logistic_regression")
        self.assertTrue(record["prediction"]["modelVersion"])
        self.assertEqual(
            record["status"], "failed"
        )
        self.assertIsNotNone(get_run_record(record["runId"]))

    def test_concurrent_writes_are_complete_and_unique(self) -> None:
        request = OptimizeRequest.model_validate(request_payload())
        with ThreadPoolExecutor(max_workers=8) as executor:
            plans = list(
                executor.map(lambda _: build_allocation_plan(request), range(16))
            )

        with closing(sqlite3.connect(self.database)) as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM optimization_runs"
            ).fetchone()[0]
        self.assertEqual(count, 16)
        self.assertEqual(len({plan["runId"] for plan in plans}), 16)

    def test_300_order_scarce_pipeline_finishes_and_is_logged(self) -> None:
        dataset = generate_dataset(300, 11, "scarce")
        request = OptimizeRequest.model_validate(
            {
                **dataset,
                "weights": {"onTime": 0.5, "cost": 0.3, "utilization": 0.2},
            }
        )
        started = perf_counter()
        plan = build_allocation_plan(request)
        elapsed = perf_counter() - started

        self.assertLess(elapsed, 20.0)
        self.assertEqual(
            len(plan["assignments"]) + len(plan["unassignedOrders"]),
            len(request.orders),
        )
        record = get_run_record(plan["runId"])
        self.assertIsNotNone(record)
        self.assertEqual(record["status"], "succeeded")
        self.assertEqual(record["inputCounts"]["orders"], 300)

    def test_duplicate_run_id_is_rejected_instead_of_overwritten(self) -> None:
        plan = build_allocation_plan(
            OptimizeRequest.model_validate(request_payload())
        )
        record = get_run_record(plan["runId"])
        if record is None:
            self.fail("Successful allocation did not create a run record")
        with self.assertRaises(sqlite3.IntegrityError):
            write_run_record(record)
        self.assertEqual(get_run_record(plan["runId"]), record)

    def test_http_endpoint_retrieves_record_and_returns_404_for_unknown_id(self) -> None:
        with TestClient(app) as client:
            response = client.post("/v1/optimize", json=request_payload())
            self.assertEqual(response.status_code, 200)
            run_id = response.json()["runId"]
            fetched = client.get(f"/v1/runs/{run_id}")
            missing = client.get("/v1/runs/not-a-run")

        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["runId"], run_id)
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json()["error"]["code"], "NOT_FOUND")

    def test_http_failure_is_safe_and_still_persisted(self) -> None:
        with patch(
            "allocator.apply_candidate_predictions",
            side_effect=RuntimeError("sensitive internal diagnostic"),
        ):
            with self.assertLogs("app", level="ERROR"):
                with TestClient(app, raise_server_exceptions=False) as client:
                    response = client.post("/v1/optimize", json=request_payload())

        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.json()["error"],
            {
                "code": "OPTIMIZATION_FAILED",
                "message": "The optimization run failed.",
            },
        )
        with closing(sqlite3.connect(self.database)) as connection:
            record_json = connection.execute(
                "SELECT record_json FROM optimization_runs"
            ).fetchone()[0]
        record = json.loads(record_json)
        self.assertEqual(record["failure"]["message"], "sensitive internal diagnostic")
        self.assertNotIn("sensitive internal diagnostic", response.text)

if __name__ == "__main__":
    unittest.main()
