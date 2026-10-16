from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Order(StrictModel):
    orderId: str = Field(min_length=1)
    cargoType: str = Field(min_length=1)
    quantityTonnes: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    destination: str = Field(min_length=1)
    priority: int = Field(ge=1, le=3)
    deadline: datetime

    @field_validator("deadline", mode="before")
    @classmethod
    def parse_utc_deadline(cls, value: object) -> datetime:
        if not isinstance(value, str):
            raise ValueError("deadline must be an ISO-8601 UTC string")
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("deadline must be a valid ISO-8601 timestamp") from error
        if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
            raise ValueError("deadline must include a UTC timezone")
        return parsed


class Wagon(StrictModel):
    wagonId: str = Field(min_length=1)
    capacityTonnes: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    wagonType: str = Field(min_length=1)
    location: str = Field(min_length=1)
    available: bool


class Route(StrictModel):
    routeId: str = Field(min_length=1)
    origin: str = Field(min_length=1)
    destination: str = Field(min_length=1)
    distanceKm: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    transitTimeSeconds: int = Field(gt=0)


class Weights(StrictModel):
    onTime: Annotated[float, Field(ge=0, allow_inf_nan=False)]
    cost: Annotated[float, Field(ge=0, allow_inf_nan=False)]
    utilization: Annotated[float, Field(ge=0, allow_inf_nan=False)]


class OptimizeRequest(StrictModel):
    orders: list[Order]
    wagons: list[Wagon]
    routes: list[Route]
    weights: Weights
    timeBudgetSeconds: Annotated[
        float | None, Field(ge=0.05, le=10, allow_inf_nan=False)
    ] = None


class RouteAssignment(StrictModel):
    routeId: str = Field(min_length=1)
    origin: str = Field(min_length=1)
    destination: str = Field(min_length=1)


class Assignment(StrictModel):
    orderId: str = Field(min_length=1)
    cargoType: str = Field(min_length=1)
    wagonIds: list[str] = Field(min_length=1)
    route: RouteAssignment
    quantityTonnes: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    departAt: datetime
    eta: datetime
    onTimeProbability: Annotated[float, Field(ge=0, le=1)]
    score: Annotated[float, Field(allow_inf_nan=False)]


class Metrics(StrictModel):
    utilizationPercent: Annotated[float, Field(ge=0, le=100)]
    estimatedCostPaise: str = Field(pattern=r"^[0-9]+$")
    distanceKm: Annotated[float, Field(ge=0)]
    onTimeProbability: Annotated[float, Field(ge=0, le=1)]


class UnassignedOrder(StrictModel):
    orderId: str = Field(min_length=1)
    reasonCode: Literal[
        "NO_COMPATIBLE_WAGON",
        "INCOMPATIBLE_WAGON_TYPE",
        "NO_ROUTE",
        "INSUFFICIENT_CAPACITY",
        "NO_FEASIBLE_ASSIGNMENT",
        "TIME_BUDGET_EXCEEDED",
    ]
    message: str = Field(min_length=1)


class Alternative(StrictModel):
    rank: int = Field(ge=1)
    score: Annotated[float, Field(ge=0, allow_inf_nan=False)]
    assignments: list[Assignment]
    metrics: Metrics


class Prediction(StrictModel):
    method: Literal["logistic_regression", "heuristic_fallback", "mixed"]
    modelVersion: str | None


class InputCounts(StrictModel):
    orders: int = Field(ge=0)
    wagons: int = Field(ge=0)
    routes: int = Field(ge=0)


class RunMetadata(StrictModel):
    generatedAt: datetime
    durationMs: int = Field(ge=0)
    algorithm: str = Field(min_length=1)
    weights: Weights
    inputHash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    inputCounts: InputCounts
    prediction: Prediction


class AllocationPlan(StrictModel):
    planId: str = Field(min_length=1)
    runId: str = Field(min_length=1)
    score: Annotated[float, Field(ge=0, allow_inf_nan=False)]
    assignments: list[Assignment]
    metrics: Metrics
    unassignedOrders: list[UnassignedOrder]
    alternatives: list[Alternative]
    runMetadata: RunMetadata


class RunParameters(StrictModel):
    weights: Weights
    timeBudgetSeconds: Annotated[float, Field(ge=0.05, le=10, allow_inf_nan=False)]
    requestedTimeBudgetSeconds: Annotated[
        float | None, Field(ge=0.05, le=10, allow_inf_nan=False)
    ]
    searchWorkers: int = Field(ge=1)
    randomSeed: int
    maxSearchCandidates: int = Field(ge=1)
    heuristicStrategies: int = Field(ge=1)
    dwellTimeSeconds: int = Field(ge=0)
    costPaisePerWagonKm: int = Field(ge=0)
    priorityObjective: str = Field(min_length=1)


class RunPrediction(StrictModel):
    method: Literal[
        "logistic_regression", "heuristic_fallback", "mixed", "not_run"
    ]
    modelVersion: str | None


class RunFailure(StrictModel):
    stage: str = Field(min_length=1)
    type: str = Field(min_length=1)
    message: str


class OptimizationRunRecord(StrictModel):
    runId: str = Field(min_length=1)
    startedAt: datetime
    completedAt: datetime
    durationMs: int = Field(ge=0)
    status: Literal["succeeded", "failed"]
    planId: str | None
    algorithm: str = Field(min_length=1)
    parameters: RunParameters
    prediction: RunPrediction
    inputCounts: InputCounts
    inputHash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    inputSnapshot: OptimizeRequest
    failure: RunFailure | None

    @field_validator("startedAt", "completedAt")
    @classmethod
    def require_utc_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value):
            raise ValueError("run timestamps must be UTC")
        return value

    @model_validator(mode="after")
    def validate_status_details(self) -> "OptimizationRunRecord":
        if self.status == "succeeded":
            if self.planId is None or self.failure is not None:
                raise ValueError("successful runs require a plan and no failure")
            if self.prediction.method == "not_run":
                raise ValueError("successful runs must report a prediction method")
        elif self.planId is not None or self.failure is None:
            raise ValueError("failed runs require failure details and no plan")

        if self.prediction.method in ("logistic_regression", "mixed"):
            if self.prediction.modelVersion is None:
                raise ValueError("model predictions require a model version")
        elif self.prediction.modelVersion is not None:
            raise ValueError("fallback or unrun predictions cannot have a model version")
        return self
