#!/usr/bin/env python3
import json
import sys
import time


def main():
    args = json.loads(sys.stdin.read() or "{}")
    seconds = float(args.get("seconds", 1))
    time.sleep(max(0.0, seconds))
    print(json.dumps({"status": "ok", "slept_seconds": seconds}))


if __name__ == "__main__":
    main()
