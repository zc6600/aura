#!/usr/bin/env python3
import json
import sys

from ak_registry import attach_ralph, latest
from verify_submission import verify


def main():
    run = latest()
    if not run:
        print(json.dumps({"completed": False, "problems": ["no registry run found"]}))
        return 1
    sub = run.get("submission_path")
    run_id = run.get("run_id")
    result = verify(sub, run_id)
    if result["completed"]:
        attach_ralph(run_id, f"reports/verify_{run_id}.json")
    print(json.dumps(result))
    return 0 if result["completed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
