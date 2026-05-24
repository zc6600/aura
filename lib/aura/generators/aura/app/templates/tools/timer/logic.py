#!/usr/bin/env python3
import sys
import json
import time
import os

def check_pid(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False

def main():
    try:
        raw_args = sys.stdin.read().strip()
        args = json.loads(raw_args) if raw_args else {}
    except Exception as e:
        print(json.dumps({"error": f"Failed to parse input: {str(e)}", "status": "error"}))
        return

    seconds = args.get("seconds")
    wait_pid = args.get("wait_pid")
    poll_interval = args.get("poll_interval", 2)
    timeout_seconds = args.get("timeout_seconds", 300)

    if seconds is not None:
        try:
            sleep_time = float(seconds)
            time.sleep(sleep_time)
            print(json.dumps({"status": "ok", "message": f"Paused execution for {sleep_time} seconds."}))
        except Exception as e:
            print(json.dumps({"error": f"Failed to sleep: {str(e)}", "status": "error"}))
        return

    if wait_pid is not None:
        try:
            pid = int(wait_pid)
        except ValueError:
            print(json.dumps({"error": f"Invalid PID: {wait_pid}", "status": "error"}))
            return

        start_time = time.time()
        elapsed = 0
        while check_pid(pid):
            if elapsed >= timeout_seconds:
                print(json.dumps({
                    "status": "timeout",
                    "message": f"Timed out waiting for process {pid} after {timeout_seconds} seconds.",
                    "elapsed_seconds": elapsed
                }))
                return
            time.sleep(poll_interval)
            elapsed = time.time() - start_time

        # Once finished, fetch output files if they exist in state/commands
        state_dir = os.path.join(os.getcwd(), "state", "commands")
        out_file = os.path.join(state_dir, f"{pid}.out")
        err_file = os.path.join(state_dir, f"{pid}.err")
        stdout = ""
        stderr = ""
        if os.path.exists(out_file):
            try:
                with open(out_file, "r", encoding="utf-8", errors="ignore") as f:
                    stdout = f.read()
            except Exception:
                pass
        if os.path.exists(err_file):
            try:
                with open(err_file, "r", encoding="utf-8", errors="ignore") as f:
                    stderr = f.read()
            except Exception:
                pass

        meta_file = os.path.join(state_dir, f"{pid}.json")
        exit_code = None
        if os.path.exists(meta_file):
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                    exit_code = meta.get("exit_code")
            except Exception:
                pass

        print(json.dumps({
            "status": "finished",
            "pid": pid,
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": exit_code,
            "elapsed_seconds": elapsed
        }))
        return

    print(json.dumps({"error": "Either 'seconds' or 'wait_pid' must be provided.", "status": "error"}))

if __name__ == "__main__":
    main()
