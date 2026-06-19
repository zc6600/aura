import json
import sys
import os
import csv
import sqlite3
import datetime as dt

class AuraTool:
    @staticmethod
    def get_input() -> dict:
        """Parses stdin and returns the JSON argument dict."""
        try:
            raw = sys.stdin.read().strip()
            return json.loads(raw) if raw else {}
        except Exception as e:
            return {"error": f"Failed to parse stdin: {str(e)}"}

    @staticmethod
    def send_output(data: dict):
        """Standardized JSON output printing and process exit."""
        print(json.dumps(data))
        sys.exit(0)

    @staticmethod
    def load_yaml(path: str) -> dict:
        """Robust YAML parsing with fallback regex parsing if PyYAML is missing."""
        if not os.path.exists(path):
            return {}
        try:
            import yaml
            with open(path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f) or {}
        except ImportError:
            config = {}
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if ":" in line:
                        k, v = line.split(":", 1)
                        config[k.strip()] = v.strip().strip("'\"")
            return config

class CSVValidator:
    @staticmethod
    def align_with_sample(submission_path: str, sample_path: str) -> tuple[bool, list[str]]:
        """Validates columns, row counts, ID alignment, and missing values."""
        problems = []
        if not os.path.exists(submission_path):
            return False, ["submission_file_missing"]
        if not os.path.exists(sample_path):
            return False, ["sample_file_missing"]
        
        try:
            with open(sample_path, newline="", encoding="utf-8") as fs, \
                 open(submission_path, newline="", encoding="utf-8") as fd:
                sample_reader = csv.reader(fs)
                sub_reader = csv.reader(fd)
                sample_header = next(sample_reader, [])
                sub_header = next(sub_reader, [])
                
                if sample_header != sub_header:
                    problems.append("columns_mismatch")
                
                sample_rows = list(sample_reader)
                sub_rows = list(sub_reader)
                
                if len(sample_rows) != len(sub_rows):
                    problems.append("row_count_mismatch")
                else:
                    if any(s[0] != d[0] for s, d in zip(sample_rows, sub_rows)):
                        problems.append("id_alignment_mismatch")
                
                if any(any(c == "" for c in r) for r in sub_rows):
                    problems.append("contains_missing_values")
        except Exception as e:
            return False, [f"parse_error: {str(e)}"]
            
        return len(problems) == 0, problems

class RunRegistry:
    def __init__(self, db_path="experiments/runs.sqlite"):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
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
        """)
        conn.commit()
        conn.close()

    def record(self, run_id: str, payload: dict) -> dict:
        now = dt.datetime.utcnow().isoformat() + "Z"
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
        INSERT OR REPLACE INTO runs (
          run_id, created_at, status, hypothesis, model_family, metric_name,
          cv_score, cv_std, higher_is_better, params_json, changed_files_json,
          artifacts_json, submission_path, submission_sha256, ralph_result_path,
          notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
          run_id,
          payload.get("created_at") or now,
          payload.get("status", "candidate"),
          payload.get("hypothesis"),
          payload.get("model_family"),
          payload.get("metric_name"),
          payload.get("cv_score"),
          payload.get("cv_std"),
          1 if payload.get("higher_is_better", True) else 0,
          json.dumps(payload.get("params", {}), sort_keys=True),
          json.dumps(payload.get("changed_files", []), sort_keys=True),
          json.dumps(payload.get("artifacts", {}), sort_keys=True),
          payload.get("submission_path"),
          payload.get("submission_sha256"),
          payload.get("ralph_result_path"),
          payload.get("notes")
        ))
        conn.commit()
        conn.close()
        return {"status": "ok", "run_id": run_id}

    def get(self, run_id: str) -> dict:
        conn = sqlite3.connect(self.db_path)
        row = conn.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)).fetchone()
        conn.close()
        if not row:
            return {}
        keys = [
          "run_id", "created_at", "status", "hypothesis", "model_family", "metric_name",
          "cv_score", "cv_std", "higher_is_better", "params_json", "changed_files_json",
          "artifacts_json", "submission_path", "submission_sha256", "ralph_result_path",
          "kaggle_submission_id", "public_score", "private_score", "lb_status", "notes"
        ]
        return dict(zip(keys, row))
