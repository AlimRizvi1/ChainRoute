import asyncio
import json
import unittest

from app import app
from models import OptimizeRequest


class OptimizeHttpValidationTests(unittest.TestCase):
    def test_search_budget_is_bounded(self) -> None:
        common = {
            "orders": [],
            "wagons": [],
            "routes": [],
            "weights": {"onTime": 1, "cost": 0, "utilization": 0},
        }
        for budget in (0.05, 1, 10):
            OptimizeRequest.model_validate(
                {**common, "timeBudgetSeconds": budget}
            )
        for budget in (0.049, 10.001):
            with self.subTest(budget=budget), self.assertRaises(ValueError):
                OptimizeRequest.model_validate(
                    {**common, "timeBudgetSeconds": budget}
                )

    def test_negative_weight_returns_field_specific_http_400(self) -> None:
        body = json.dumps(
            {
                "orders": [],
                "wagons": [],
                "routes": [],
                "weights": {
                    "onTime": -0.1,
                    "cost": 1,
                    "utilization": 1,
                },
            }
        ).encode()
        messages: list[dict] = []
        request_pending = True

        async def receive() -> dict:
            nonlocal request_pending
            if request_pending:
                request_pending = False
                return {
                    "type": "http.request",
                    "body": body,
                    "more_body": False,
                }
            return {"type": "http.disconnect"}

        async def send(message: dict) -> None:
            messages.append(message)

        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/v1/optimize",
            "raw_path": b"/v1/optimize",
            "query_string": b"",
            "root_path": "",
            "headers": [
                (b"content-type", b"application/json"),
                (b"host", b"testserver"),
            ],
            "client": ("testclient", 50000),
            "server": ("testserver", 80),
        }
        asyncio.run(app(scope, receive, send))

        response_start = next(
            message for message in messages if message["type"] == "http.response.start"
        )
        response_body = b"".join(
            message.get("body", b"")
            for message in messages
            if message["type"] == "http.response.body"
        )
        response = json.loads(response_body)
        self.assertEqual(response_start["status"], 400)
        self.assertEqual(response["error"]["code"], "VALIDATION_ERROR")
        self.assertIn("weights.onTime", response["error"]["fields"])


if __name__ == "__main__":
    unittest.main()
