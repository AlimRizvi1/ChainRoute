import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

RUN_LOG_PATH = Path(
    os.environ.get(
        "AI_RUN_LOG_PATH",
        str(Path(__file__).with_name("optimization-runs.sqlite3")),
    )
)


def write_run_record(record: dict[str, Any]) -> None:
    RUN_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(record, sort_keys=True, separators=(",", ":"))
    with closing(sqlite3.connect(RUN_LOG_PATH, timeout=10.0)) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS optimization_runs (
                run_id TEXT PRIMARY KEY,
                completed_at TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
                record_json TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            INSERT INTO optimization_runs (run_id, completed_at, status, record_json)
            VALUES (?, ?, ?, ?)
            """,
            (
                record["runId"],
                record["completedAt"],
                record["status"],
                serialized,
            ),
        )
        connection.commit()


def get_run_record(run_id: str) -> dict[str, Any] | None:
    if not RUN_LOG_PATH.is_file():
        return None
    with closing(sqlite3.connect(RUN_LOG_PATH, timeout=10.0)) as connection:
        row = connection.execute(
            "SELECT record_json FROM optimization_runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
    return json.loads(row[0]) if row else None
