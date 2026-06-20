#!/usr/bin/env python3
import csv
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone


PARAMS = "params/autokaggle.yml"
SAMPLE = "data/raw/sample_submission.csv"
STATE = "reports/submit_guard_state.json"
REGISTRY = ".aura-workspace/state/experiments.db"


def read_args():
    raw = sys.stdin.read().strip()
    return json.loads(raw) if raw else {}


def read_params_text():
    if not os.path.exists(PARAMS):
        return ""
    with open(PARAMS, "r", encoding="utf-8") as f:
        return f.read()


def nested_value(section, key, default=None):
    text = read_params_text()
    current = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.strip().startswith("#"):
            continue
        if not raw.startswith(" ") and line.endswith(":"):
            current = line[:-1].strip()
            continue
        if current == section and line.strip().startswith(key + ":"):
            val = line.split(":", 1)[1].strip().strip('"').strip("'")
            if val == "true":
                return True
            if val == "false":
                return False
            if val == "null":
                return None
            try:
                return int(val)
            except ValueError:
                return val
    return default


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.reader(f))


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def load_state():
    if not os.path.exists(STATE):
        return {"submissions": []}
    with open(STATE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_state(state):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def registry_run(run_id):
    if not os.path.exists(REGISTRY):
        return None
    conn = sqlite3.connect(REGISTRY)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def format_checks(path):
    failed = []
    if not path or not os.path.exists(path):
        return ["submission_missing"]
    if not os.path.exists(SAMPLE):
        return ["sample_submission_missing"]
    sample = read_csv(SAMPLE)
    sub = read_csv(path)
    if not sample or not sub or sample[0] != sub[0]:
        failed.append("columns")
    if len(sample) != len(sub):
        failed.append("row_count")
    if len(sample) == len(sub) and [r[0] for r in sample[1:]] != [r[0] for r in sub[1:]]:
        failed.append("id_order")
    if any(any(c == "" for c in row) for row in sub[1:]):
        failed.append("missing_values")
    return failed


def budget_status():
    state = load_state()
    now = time.time()
    today = datetime.now(timezone.utc).date().isoformat()
    daily_budget = int(nested_value("submission", "daily_budget", 3) or 3)
    cooldown_minutes = int(nested_value("submission", "cooldown_minutes", 30) or 30)
    max_wait = int(nested_value("submission", "max_wait_chunk_seconds", 900) or 900)
    todays = [
        item for item in state.get("submissions", [])
        if item.get("submitted_day") == today and item.get("real_submit")
    ]
    if len(todays) >= daily_budget:
        return {
            "status": "wait_required",
            "reason": "daily_budget_exhausted",
            "wait_seconds": 86400,
            "wait_chunk_seconds": min(max_wait, 86400),
        }
    real = [item for item in state.get("submissions", []) if item.get("real_submit")]
    if real:
        last = max(item.get("submitted_at", 0) for item in real)
        wait = cooldown_minutes * 60 - (now - last)
        if wait > 0:
            return {
                "status": "wait_required",
                "reason": "cooldown_active",
                "wait_seconds": int(wait),
                "wait_chunk_seconds": min(max_wait, int(wait)),
            }
    return {"status": "ok", "daily_used": len(todays), "daily_budget": daily_budget}


def validate(args):
    path = args.get("submission_path")
    run_id = args.get("run_id")
    dry_run = bool(args.get("dry_run", False))
    failed = format_checks(path)
    if failed:
        return {"status": "failed", "failed_checks": failed}
    run = registry_run(run_id) if run_id else None
    if run_id and not run:
        return {"status": "failed", "failed_checks": ["registry_run_missing"]}
    sub_hash = sha256_file(path)
    state = load_state()
    if any(item.get("submission_sha256") == sub_hash for item in state.get("submissions", [])):
        return {"status": "failed", "failed_checks": ["duplicate_submission_hash"]}
    budget = budget_status()
    if budget.get("status") == "wait_required":
        return budget
    allow_submit = bool(nested_value("submission", "allow_submit", False))
    require_ralph = bool(nested_value("submission", "require_ralph_verifier", True))
    if not dry_run and allow_submit and require_ralph:
        if not run or not run.get("ralph_result_path"):
            return {"status": "failed", "failed_checks": ["ralph_result_missing"]}
    return {
        "status": "ok",
        "dry_run": dry_run or not allow_submit,
        "submission_sha256": sub_hash,
        "run_id": run_id,
    }


def call_competition_submit(path, message, run_id):
    proc = subprocess.run(
        ["python", "tools/ak_competition/logic.py"],
        input=json.dumps({"action": "submit", "submission_path": path, "message": message, "run_id": run_id}),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        return json.loads(proc.stdout)
    except Exception:
        return {"status": "failed", "stdout": proc.stdout[-2000:], "stderr": proc.stderr[-2000:]}


def submit(args):
    path = args.get("submission_path")
    run_id = args.get("run_id")
    allow_submit = bool(nested_value("submission", "allow_submit", False))
    res = validate({**args, "dry_run": not allow_submit})
    if res.get("status") != "ok":
        return res
    if not allow_submit:
        return {"status": "ok", "dry_run": True, "reason": "allow_submit_false", "guard": res}
    message = args.get("message") or f"{nested_value('submission', 'message_prefix', 'autokaggle')} {run_id}"
    submit_res = call_competition_submit(path, message, run_id)
    if submit_res.get("status") == "ok":
        state = load_state()
        state.setdefault("submissions", []).append(
            {
                "run_id": run_id,
                "submission_path": path,
                "submission_sha256": res.get("submission_sha256"),
                "submitted_at": time.time(),
                "submitted_day": datetime.now(timezone.utc).date().isoformat(),
                "real_submit": True,
            }
        )
        save_state(state)
    return {"status": submit_res.get("status", "failed"), "guard": res, "submit": submit_res}


def main():
    try:
        args = read_args()
        action = args.get("action")
        if action == "validate":
            print(json.dumps(validate(args)))
        elif action == "budget":
            print(json.dumps(budget_status()))
        elif action == "submit":
            print(json.dumps(submit(args)))
        else:
            print(json.dumps({"status": "failed", "error": f"unknown action: {action}"}))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)}))


if __name__ == "__main__":
    main()
