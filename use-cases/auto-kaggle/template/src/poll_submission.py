#!/usr/bin/env python3
import argparse
import json
import subprocess
import time


def call_tool(payload):
    proc = subprocess.run(
        ["python", "tools/ak_competition/logic.py"],
        input=json.dumps(payload),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        return json.loads(proc.stdout)
    except Exception:
        return {"status": "failed", "stdout": proc.stdout[-2000:], "stderr": proc.stderr[-2000:]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--max-polls", type=int, default=10)
    parser.add_argument("--sleep-seconds", type=int, default=120)
    args = parser.parse_args()

    last = None
    for _ in range(args.max_polls):
        last = call_tool({"action": "submissions", "run_id": args.run_id})
        text = json.dumps(last).lower()
        if "complete" in text or "submitted" in text:
            print(json.dumps({"status": "ok", "poll": last}, indent=2))
            return
        time.sleep(args.sleep_seconds)
    print(json.dumps({"status": "timeout", "last": last}, indent=2))


if __name__ == "__main__":
    main()
