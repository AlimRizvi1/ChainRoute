import json
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from models import OptimizeRequest


app = FastAPI(title="ChainRoute AI/ML Allocation Engine", version="1.0.0")
PLAN_PATH = Path(os.environ.get("ALLOCATION_PLAN_PATH", "/app/allocation-plan.json"))


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    fields = {
        ".".join(str(part) for part in error["loc"][1:]): error["msg"]
        for error in exc.errors()
    }
    return JSONResponse(
        status_code=400,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request does not match the optimize contract.",
                "fields": fields,
            }
        },
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/optimize")
def optimize(request: OptimizeRequest) -> dict:
    # Keep the Phase 2 fixture response until the Phase 4 allocator replaces it.
    del request
    with PLAN_PATH.open(encoding="utf-8") as plan_file:
        return json.load(plan_file)
