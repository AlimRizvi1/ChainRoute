from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Order(StrictModel):
    orderId: str = Field(min_length=1)
    cargoType: str = Field(min_length=1)
    quantityTonnes: Annotated[float, Field(gt=0)]
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
    capacityTonnes: Annotated[float, Field(gt=0)]
    wagonType: str = Field(min_length=1)
    location: str = Field(min_length=1)
    available: bool


class Route(StrictModel):
    routeId: str = Field(min_length=1)
    origin: str = Field(min_length=1)
    destination: str = Field(min_length=1)
    distanceKm: Annotated[float, Field(gt=0)]
    transitTimeSeconds: int = Field(gt=0)


class Weights(StrictModel):
    onTime: Annotated[float, Field(ge=0, le=1)]
    cost: Annotated[float, Field(ge=0, le=1)]
    utilization: Annotated[float, Field(ge=0, le=1)]


class OptimizeRequest(StrictModel):
    orders: list[Order]
    wagons: list[Wagon]
    routes: list[Route]
    weights: Weights


class RouteAssignment(StrictModel):
    routeId: str = Field(min_length=1)
    origin: str = Field(min_length=1)
    destination: str = Field(min_length=1)


class Assignment(StrictModel):
    orderId: str = Field(min_length=1)
    cargoType: str = Field(min_length=1)
    wagonIds: list[str] = Field(min_length=1)
    route: RouteAssignment
    quantityTonnes: Annotated[float, Field(gt=0)]
    departAt: datetime
    eta: datetime
    onTimeProbability: Annotated[float, Field(ge=0, le=1)]
    score: float


class Metrics(StrictModel):
    utilizationPercent: Annotated[float, Field(ge=0, le=100)]
    estimatedCostPaise: str = Field(pattern=r"^[0-9]+$")
    distanceKm: Annotated[float, Field(ge=0)]
    onTimeProbability: Annotated[float, Field(ge=0, le=1)]


class UnassignedOrder(StrictModel):
    orderId: str = Field(min_length=1)
    reasonCode: Literal[
        "NO_COMPATIBLE_WAGON",
        "NO_ROUTE",
        "INSUFFICIENT_CAPACITY",
        "NO_FEASIBLE_ASSIGNMENT",
        "TIME_BUDGET_EXCEEDED",
    ]
    message: str = Field(min_length=1)


class Alternative(StrictModel):
    rank: int = Field(ge=1)
    score: float
    assignments: list[Assignment]
    metrics: Metrics


class Prediction(StrictModel):
    method: Literal["logistic_regression", "heuristic_fallback"]
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
    assignments: list[Assignment]
    metrics: Metrics
    unassignedOrders: list[UnassignedOrder]
    alternatives: list[Alternative]
    runMetadata: RunMetadata
