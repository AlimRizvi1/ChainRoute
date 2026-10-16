import math
import random
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, TypedDict

from pydantic import ValidationError

from models import Order, Route, Wagon

Scenario = Literal["plentiful", "scarce"]
Record = dict[str, Any]

CARGO_TO_WAGON = {
    "grain": "covered",
    "coal": "open",
    "steel": "flat",
}
BASE_LOCATION = "Yard-0"
DESTINATION_ROUTES = (
    ("Port-A", 120, 36_000),
    ("Plant-B", 180, 43_200),
    ("Depot-C", 90, 28_800),
    ("Port-D", 210, 50_400),
)
WAGON_CAPACITY_TONNES = 20
SYNTHETIC_START = datetime(2026, 1, 7, 20, 0, tzinfo=timezone.utc)


class ValidationResult(TypedDict):
    valid: list[Record]
    rejected: list[Record]


class MasterDataValidationResult(TypedDict):
    wagons: ValidationResult
    routes: ValidationResult


class OptimizeDataset(TypedDict):
    orders: list[Record]
    wagons: list[Record]
    routes: list[Record]


def generate_dataset(
    order_count: int, seed: int, scenario: Scenario
) -> OptimizeDataset:
    if (
        isinstance(order_count, bool)
        or not isinstance(order_count, int)
        or order_count < 0
    ):
        raise ValueError("order_count must be a non-negative integer")
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise ValueError("seed must be an integer")
    if scenario not in ("plentiful", "scarce"):
        raise ValueError("scenario must be 'plentiful' or 'scarce'")

    rng = random.Random(seed)
    cargo_types = list(CARGO_TO_WAGON)
    destinations = [route[0] for route in DESTINATION_ROUTES]
    cargos = _balanced_choices(cargo_types, order_count, rng)
    order_destinations = _balanced_choices(destinations, order_count, rng)
    deadline_bands = _balanced_choices(
        ["comfortable", "tight", "impossible"], order_count, rng
    )

    orders: list[Record] = []
    demand_by_cargo = {cargo: 0 for cargo in cargo_types}
    for index, (cargo, destination, deadline_band) in enumerate(
        zip(cargos, order_destinations, deadline_bands, strict=True), start=1
    ):
        transit_seconds = _route_for(destination)["transitTimeSeconds"]
        quantity = rng.choice((40, 60, 80, 100))
        deadline_offset = {
            "comfortable": transit_seconds + 86_400,
            "tight": max(60, transit_seconds - 3_600),
            "impossible": 300,
        }[deadline_band]
        orders.append(
            {
                "orderId": f"ORD-{index:04d}",
                "cargoType": cargo,
                "quantityTonnes": quantity,
                "destination": destination,
                "priority": rng.randint(1, 3),
                "deadline": _format_utc(
                    SYNTHETIC_START + timedelta(seconds=deadline_offset)
                ),
            }
        )
        demand_by_cargo[cargo] += quantity

    wagons = _generate_wagons(demand_by_cargo, scenario)
    routes = [
        {
            "routeId": f"RTE-{index:03d}",
            "origin": BASE_LOCATION,
            "destination": destination,
            "distanceKm": distance_km,
            "transitTimeSeconds": transit_seconds,
        }
        for index, (destination, distance_km, transit_seconds) in enumerate(
            DESTINATION_ROUTES, start=1
        )
    ]
    return {"orders": orders, "wagons": wagons, "routes": routes}


def validate_orders(records: Sequence[object]) -> ValidationResult:
    return _validate_records(records, Order, "orderId")


def validate_wagons(records: Sequence[object]) -> ValidationResult:
    return _validate_records(records, Wagon, "wagonId")


def validate_routes(records: Sequence[object]) -> ValidationResult:
    return _validate_records(records, Route, "routeId")


def validate_master_data(
    wagons: Sequence[object], routes: Sequence[object]
) -> MasterDataValidationResult:
    return {
        "wagons": validate_wagons(wagons),
        "routes": validate_routes(routes),
    }


def _balanced_choices(
    values: list[str], count: int, rng: random.Random
) -> list[str]:
    choices = [values[index % len(values)] for index in range(count)]
    rng.shuffle(choices)
    return choices


def _route_for(destination: str) -> Record:
    return next(
        {
            "destination": route_destination,
            "distanceKm": distance_km,
            "transitTimeSeconds": transit_seconds,
        }
        for route_destination, distance_km, transit_seconds in DESTINATION_ROUTES
        if route_destination == destination
    )


def _generate_wagons(
    demand_by_cargo: dict[str, int], scenario: Scenario
) -> list[Record]:
    wagons: list[Record] = []
    next_id = 1
    for cargo, wagon_type in CARGO_TO_WAGON.items():
        demand = demand_by_cargo[cargo]
        if scenario == "plentiful":
            available_count = math.ceil(6 * demand / (5 * WAGON_CAPACITY_TONNES))
        else:
            available_count = math.floor(3 * demand / (5 * WAGON_CAPACITY_TONNES))
        unavailable_count = math.ceil(available_count / 10) if available_count else 0
        for available in (True, False):
            count = available_count if available else unavailable_count
            for _ in range(count):
                wagons.append(
                    {
                        "wagonId": f"WAG-{next_id:04d}",
                        "capacityTonnes": WAGON_CAPACITY_TONNES,
                        "wagonType": wagon_type,
                        "location": BASE_LOCATION,
                        "available": available,
                    }
                )
                next_id += 1
    return wagons


def _format_utc(value: datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def _validate_records(
    records: Sequence[object],
    model: type[Order] | type[Wagon] | type[Route],
    id_key: str,
) -> ValidationResult:
    valid: list[Record] = []
    rejected: list[Record] = []
    seen_ids: set[str] = set()

    for raw_record in records:
        record_id = (
            raw_record.get(id_key)
            if isinstance(raw_record, dict) and isinstance(raw_record.get(id_key), str)
            else None
        )
        if isinstance(record_id, str) and record_id in seen_ids:
            rejected.append({"id": record_id, "reason": "DUPLICATE_ID"})
            continue
        if isinstance(record_id, str) and record_id:
            seen_ids.add(record_id)

        try:
            valid.append(model.model_validate(raw_record).model_dump(mode="json"))
        except ValidationError as error:
            rejected.append(
                {
                    "id": record_id,
                    "reason": _rejection_reason(error, id_key),
                }
            )

    return {"valid": valid, "rejected": rejected}


def _rejection_reason(error: ValidationError, id_key: str) -> str:
    detail = error.errors()[0]
    location = detail["loc"]
    field = str(location[0]) if location else id_key
    error_type = detail["type"]
    if error_type == "missing":
        return f"MISSING_FIELD:{field}"
    if error_type == "extra_forbidden":
        return f"UNKNOWN_FIELD:{field}"
    if error_type == "string_too_short":
        return f"EMPTY_FIELD:{field}"
    if field == "quantityTonnes":
        return "BAD_QUANTITY"
    if field == "priority":
        return "BAD_PRIORITY"
    if field == "deadline":
        return "BAD_DEADLINE"
    if field == "capacityTonnes":
        return "BAD_CAPACITY"
    if field == "distanceKm":
        return "BAD_DISTANCE"
    if field == "transitTimeSeconds":
        return "BAD_TRANSIT_TIME"
    return f"INVALID_FIELD:{field}"
