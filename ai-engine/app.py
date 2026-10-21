import json
import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from allocator import build_allocation_plan
from models import OptimizationRunRecord, OptimizeRequest
from run_log import get_run_record

app = FastAPI(title="ChainRoute AI/ML Allocation Engine", version="1.0.0")
logger = logging.getLogger(__name__)
app.mount("/demo", StaticFiles(directory=Path(__file__).with_name("demo"), html=True), name="ml-demo")


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    del _request
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


@app.exception_handler(Exception)
async def internal_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    del _request
    logger.exception("AI engine request failed", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "OPTIMIZATION_FAILED",
                "message": "The optimization run failed.",
            }
        },
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/runs/{run_id}", response_model=OptimizationRunRecord)
def get_optimization_run(run_id: str) -> OptimizationRunRecord | JSONResponse:
    record = get_run_record(run_id)
    if record is None:
        return JSONResponse(
            status_code=404,
            content={
                "error": {
                    "code": "NOT_FOUND",
                    "message": "Optimization run was not found.",
                }
            },
        )
    return OptimizationRunRecord.model_validate_json(json.dumps(record))


@app.post("/v1/optimize")
def optimize(request: OptimizeRequest) -> dict:
    return build_allocation_plan(request)
