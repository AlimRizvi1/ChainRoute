from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from allocator import build_allocation_plan
from models import OptimizeRequest

app = FastAPI(title="ChainRoute AI/ML Allocation Engine", version="1.0.0")
app = FastAPI(title="ChainRoute AI/ML Allocation Engine", version="1.0.0")


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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/optimize")
def optimize(request: OptimizeRequest) -> dict:
    return build_allocation_plan(request)
