#!/usr/bin/env python3
import json
import time

from ak_registry import latest


def main():
    last = latest()
    if not last:
        payload = {
            "status": "ok",
            "next_run_id": f"baseline_{int(time.time())}",
            "hypothesis": "Create the first baseline candidate.",
        }
    else:
        payload = {
            "status": "ok",
            "next_run_id": f"candidate_{int(time.time())}",
            "previous_run_id": last["run_id"],
            "hypothesis": "Try one conservative improvement over the best recorded CV run.",
        }
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
