import sys
import json
import subprocess
import os
import time
import signal
from datetime import datetime, timezone

def _truncate_middle(text, max_chars, head_ratio=0.6):
    try:
        s = text or ""
        if max_chars is None or max_chars <= 0:
            return s, False
        if len(s) <= max_chars:
            return s, False
        head = int(max_chars * head_ratio)
        head = max(0, min(head, max_chars))
        tail = max_chars - head
        truncated = s[:head] + "\n...[truncated]...\n" + (s[-tail:] if tail > 0 else "")
        return truncated, True
    except Exception:
        return text or "", False


def to_iso(ts):
    try:
        dt = datetime.fromtimestamp(float(ts)).astimezone()
        return dt.isoformat()
    except Exception:
        return None


def execute_command(command, chdir=None, timeout_seconds=None, max_output_chars=None, head_ratio=0.6, pid=None, fetch=False, fetch_all=False, wait_seconds=None, terminate_pid=None, signal_name=None):
    try:
        cwd = chdir or os.getcwd()

        if max_output_chars is None or max_output_chars <= 0:
            max_output_chars = 30000

        if terminate_pid is None and pid is None and not fetch_all:
            if not command:
                return {"error": "Missing required parameter 'command'", "status": "error"}

        # Terminate a running process
        if terminate_pid is not None:
            try:
                tpid = int(terminate_pid)
            except Exception:
                return {"error": "Invalid terminate_pid", "status": "error"}
            sig = str(signal_name or "TERM").upper()
            sig_map = {"TERM": signal.SIGTERM, "KILL": signal.SIGKILL, "INT": signal.SIGINT}
            s = sig_map.get(sig, signal.SIGTERM)
            try:
                os.kill(tpid, s)
                return {"status": "terminated", "pid": tpid, "signal": sig}
            except Exception as e:
                return {"status": "error", "error": str(e), "pid": tpid, "signal": sig}

        if pid is not None and fetch:
            if isinstance(wait_seconds, (int, float)) and wait_seconds > 0:
                try:
                    time.sleep(wait_seconds)
                except Exception:
                    pass
            try:
                pid = int(pid)
            except Exception:
                return {"error": "Invalid pid", "status": "error"}
            state_root = os.path.join(cwd, ".aura", "state") if os.path.exists(os.path.join(cwd, ".aura")) else os.path.join(cwd, "state")
            state_dir = os.path.join(state_root, "commands")
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
            # Check running status
            running = True
            try:
                os.kill(pid, 0)
                running = True
            except OSError:
                running = False
            t_out, trunc_o = _truncate_middle(stdout, max_output_chars, head_ratio)
            t_err, trunc_e = _truncate_middle(stderr, max_output_chars, head_ratio)
            meta_file = os.path.join(state_dir, f"{pid}.json")
            meta = {}
            if os.path.exists(meta_file):
                try:
                    with open(meta_file, "r", encoding="utf-8") as mf:
                        meta = json.load(mf)
                except Exception:
                    meta = {}
            started_at = meta.get("started_at")
            elapsed = None
            try:
                if started_at:
                    elapsed = max(0, time.time() - float(started_at))
            except Exception:
                elapsed = None

            return {
                "status": "running" if running else "finished",
                "pid": pid,
                "stdout": t_out,
                "stderr": t_err,
                "stdout_truncated": trunc_o,
                "stderr_truncated": trunc_e,
                "elapsed_seconds": elapsed,
                "started_at": started_at,
                "started_at_iso": to_iso(started_at),
                "ended_at_iso": to_iso(meta.get("ended_at"))
            }

        if fetch_all:
            if isinstance(wait_seconds, (int, float)) and wait_seconds > 0:
                try:
                    time.sleep(wait_seconds)
                except Exception:
                    pass
            state_root = os.path.join(cwd, ".aura", "state") if os.path.exists(os.path.join(cwd, ".aura")) else os.path.join(cwd, "state")
            state_dir = os.path.join(state_root, "commands")
            items = []
            try:
                for fn in os.listdir(state_dir):
                    if not fn.endswith(".json"):
                        continue
                    pmeta_path = os.path.join(state_dir, fn)
                    try:
                        with open(pmeta_path, "r", encoding="utf-8") as mf:
                            meta = json.load(mf)
                    except Exception:
                        continue
                    mpid = meta.get("pid")
                    running = True
                    try:
                        os.kill(int(mpid), 0)
                        running = True
                    except Exception:
                        running = False
                    out_path = meta.get("stdout_file")
                    err_path = meta.get("stderr_file")
                    out_bytes = os.path.getsize(out_path) if out_path and os.path.exists(out_path) else 0
                    err_bytes = os.path.getsize(err_path) if err_path and os.path.exists(err_path) else 0
                    started_at = meta.get("started_at")
                    ended_at = meta.get("ended_at")
                    elapsed = None
                    try:
                        if started_at:
                            ref = ended_at if ended_at else time.time()
                            elapsed = max(0, ref - float(started_at))
                    except Exception:
                        elapsed = None
                    items.append({
                        "pid": mpid,
                        "status": "running" if running else "finished",
                        "command": meta.get("command"),
                        "stdout_bytes": out_bytes,
                        "stderr_bytes": err_bytes,
                        "elapsed_seconds": elapsed,
                        "started_at": started_at,
                        "ended_at": ended_at,
                        "timeout_seconds": meta.get("timeout_seconds"),
                        "started_at_iso": to_iso(started_at),
                        "ended_at_iso": to_iso(ended_at)
                    })
            except Exception:
                pass
            return {"processes": items}

        eff_timeout = None
        if isinstance(wait_seconds, (int, float)) and wait_seconds > 0:
            eff_timeout = wait_seconds
        elif isinstance(timeout_seconds, (int, float)) and timeout_seconds > 0:
            eff_timeout = timeout_seconds
        else:
            eff_timeout = 60

        state_root = os.path.join(cwd, ".aura", "state") if os.path.exists(os.path.join(cwd, ".aura")) else os.path.join(cwd, "state")
        state_dir = os.path.join(state_root, "commands")
        try:
            os.makedirs(state_dir, exist_ok=True)
        except Exception:
            pass

        tmp_tag = str(int(time.time()*1000))
        out_file = os.path.join(state_dir, f"{tmp_tag}.out")
        err_file = os.path.join(state_dir, f"{tmp_tag}.err")
        out_fp = open(out_file, "ab")
        err_fp = open(err_file, "ab")

        p = subprocess.Popen(
            command,
            shell=True,
            stdout=out_fp,
            stderr=err_fp,
            cwd=cwd
        )

        try:
            pid_val = p.pid
            final_out = os.path.join(state_dir, f"{pid_val}.out")
            final_err = os.path.join(state_dir, f"{pid_val}.err")
            try:
                os.rename(out_file, final_out)
                os.rename(err_file, final_err)
                out_file = final_out
                err_file = final_err
            except Exception:
                pass

            meta = {
                "pid": pid_val,
                "command": command,
                "cwd": cwd,
                "started_at": time.time(),
                "timeout_seconds": eff_timeout,
                "stdout_file": out_file,
                "stderr_file": err_file,
                "started_at_iso": to_iso(time.time())
            }
            try:
                with open(os.path.join(state_dir, f"{pid_val}.json"), "w", encoding="utf-8") as mf:
                    mf.write(json.dumps(meta))
            except Exception:
                pass

            p.wait(timeout=eff_timeout)
            out_fp.close(); err_fp.close()
            with open(out_file, "r", encoding="utf-8", errors="ignore") as f:
                stdout = f.read()
            with open(err_file, "r", encoding="utf-8", errors="ignore") as f:
                stderr = f.read()
            t_out, trunc_o = _truncate_middle(stdout, max_output_chars, head_ratio)
            t_err, trunc_e = _truncate_middle(stderr, max_output_chars, head_ratio)
            try:
                meta.update({
                    "ended_at": time.time(),
                    "exit_code": p.returncode,
                    "status": "finished",
                    "ended_at_iso": to_iso(time.time())
                })
                with open(os.path.join(state_dir, f"{pid_val}.json"), "w", encoding="utf-8") as mf:
                    mf.write(json.dumps(meta))
            except Exception:
                pass
            return {
                "stdout": t_out,
                "stderr": t_err,
                "stdout_truncated": trunc_o,
                "stderr_truncated": trunc_e,
                "exit_code": p.returncode,
                "status": "ok" if p.returncode == 0 else "failed",
                "waited_seconds": eff_timeout
            }
        except subprocess.TimeoutExpired:
            return {
                "status": "running",
                "pid": pid_val,
                "stdout_file": out_file,
                "stderr_file": err_file,
                "message": "Process is running in background. Use pid to fetch status/output.",
                "waited_seconds": eff_timeout
            }
    except Exception as e:
        return {"error": str(e), "status": "error"}

if __name__ == "__main__":
    try:
        if len(sys.argv) > 1 and sys.argv[1].strip():
            args = json.loads(sys.argv[1])
        else:
            args = json.loads(sys.stdin.read())
        command = args.get("command")
        res = execute_command(
            command,
            chdir=args.get("chdir"),
            timeout_seconds=args.get("timeout_seconds"),
            max_output_chars=args.get("max_output_chars"),
            head_ratio=args.get("head_ratio", 0.6),
            pid=args.get("pid"),
            fetch=args.get("fetch", False),
            fetch_all=args.get("fetch_all", False),
            wait_seconds=args.get("wait_seconds"),
            terminate_pid=args.get("terminate_pid"),
            signal_name=args.get("signal")
        )
        print(json.dumps(res))
    except Exception as e:
        print(json.dumps({"error": f"Logic error: {str(e)}"}))
