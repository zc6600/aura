import json
import os
import sqlite3
from datetime import datetime, timezone


DB_PATH = ".aura-workspace/state/experiments.db"


def connect(db_path=DB_PATH):
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS runs (
          run_id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          status TEXT NOT NULL,
          hypothesis TEXT,
          model_family TEXT,
          metric_name TEXT,
          cv_score REAL,
          cv_std REAL,
          higher_is_better INTEGER,
          params_json TEXT,
          changed_files_json TEXT,
          artifacts_json TEXT,
          submission_path TEXT,
          submission_sha256 TEXT,
          ralph_result_path TEXT,
          kaggle_submission_id TEXT,
          public_score REAL,
          private_score REAL,
          lb_status TEXT,
          notes TEXT
        )
        """
    )
    return conn


def record(run_id, payload, db_path=DB_PATH):
    conn = connect(db_path)
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT OR REPLACE INTO runs (
          run_id, created_at, status, hypothesis, model_family, metric_name,
          cv_score, cv_std, higher_is_better, params_json, changed_files_json,
          artifacts_json, submission_path, submission_sha256, ralph_result_path,
          kaggle_submission_id, public_score, private_score, lb_status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            run_id,
            payload.get("created_at") or now,
            payload.get("status") or "candidate",
            payload.get("hypothesis"),
            payload.get("model_family"),
            payload.get("metric_name") or "cv_score",
            payload.get("cv_score"),
            payload.get("cv_std"),
            1 if payload.get("higher_is_better", True) else 0,
            json.dumps(payload.get("params") or {}),
            json.dumps(payload.get("changed_files") or []),
            json.dumps(payload.get("artifacts") or {}),
            payload.get("submission_path"),
            payload.get("submission_sha256"),
            payload.get("ralph_result_path"),
            payload.get("kaggle_submission_id"),
            payload.get("public_score"),
            payload.get("private_score"),
            payload.get("lb_status"),
            payload.get("notes"),
        ),
    )
    conn.commit()
    conn.close()
    return {"status": "ok", "run_id": run_id}


def get(run_id, db_path=DB_PATH):
    if not os.path.exists(db_path):
        return None
    conn = connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def latest(db_path=DB_PATH):
    if not os.path.exists(db_path):
        return None
    conn = connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM runs ORDER BY created_at DESC LIMIT 1").fetchone()
    conn.close()
    return dict(row) if row else None


def attach_ralph(run_id, result_path, db_path=DB_PATH):
    conn = connect(db_path)
    conn.execute(
        "UPDATE runs SET ralph_result_path = ? WHERE run_id = ?",
        (result_path, run_id),
    )
    conn.commit()
    conn.close()
    return {"status": "ok", "run_id": run_id, "ralph_result_path": result_path}
