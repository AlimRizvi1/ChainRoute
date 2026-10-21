"""Fixed synthetic teaching requests using the production allocator/predictor."""
import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from allocator import STRATEGIES, _build_candidate, build_allocation_plan
from demonstrate_ml import demo_request
from models import OptimizeRequest
from prediction import apply_candidate_predictions


class DemonstrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["cp-sat", "ml"]
    cargo: Literal["grain", "coal", "steel"] = "grain"
    slackRatio: Literal[0.0, 0.25, 0.5] = 0.0


def run_demonstration(options: DemonstrationRequest) -> dict:
    baseline = None
    if options.kind == "cp-sat":
        fixture = json.loads(Path(__file__).with_name("demo").joinpath("cp-sat-case.json").read_text(encoding="utf-8"))
        payload = fixture["request"]
        request = OptimizeRequest.model_validate_json(json.dumps(payload))
        greedy = _build_candidate(request, STRATEGIES[0])
        apply_candidate_predictions([greedy], request.orders, request.routes)
        baseline = {"method": "greedy_shortest_route", "assignments": greedy.assignments, "metrics": greedy.metrics}
    else:
        payload = demo_request(options.slackRatio, options.cargo)
        request = OptimizeRequest.model_validate_json(json.dumps(payload))
    return {"synthetic": True, "kind": options.kind, "request": payload,
            "baseline": baseline, "plan": build_allocation_plan(request)}
