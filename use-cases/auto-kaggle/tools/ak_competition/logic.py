#!/usr/bin/env python3
import csv
import json
import os
import shutil
import subprocess
import sys
import time
import zipfile


PARAMS = "params/autokaggle.yml"


def read_args():
    raw = sys.stdin.read().strip()
    return json.loads(raw) if raw else {}


def read_params_text():
    if not os.path.exists(PARAMS):
        return ""
    with open(PARAMS, "r", encoding="utf-8") as f:
        return f.read()


def nested_value(text, section, key, default=""):
    current = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.strip().startswith("#"):
            continue
        if not raw.startswith(" ") and line.endswith(":"):
            current = line[:-1].strip()
            continue
        if current == section and line.strip().startswith(key + ":"):
            return line.split(":", 1)[1].strip().strip('"').strip("'")
    return default


def slug():
    return nested_value(read_params_text(), "competition", "slug")


def mode():
    return nested_value(read_params_text(), "competition", "mode", "offline")


def run_kaggle(args, timeout=120):
    if not shutil.which("kaggle"):
        return {"status": "failed", "error": "kaggle CLI not found"}
    proc = subprocess.run(
        ["kaggle"] + args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )
    out = (proc.stdout or "")[-4000:]
    err = (proc.stderr or "")[-4000:]
    if proc.returncode != 0:
        return {"status": "failed", "exit_code": proc.returncode, "stdout": out, "stderr": err}
    return {"status": "ok", "stdout": out, "stderr": err}


def catalog():
    os.makedirs("reports", exist_ok=True)
    root = "data/raw"
    files = []
    for name in sorted(os.listdir(root)) if os.path.exists(root) else []:
        path = os.path.join(root, name)
        if not os.path.isfile(path) or name.endswith(".hint"):
            continue
        item = {"path": path, "bytes": os.path.getsize(path)}
        if name.endswith(".csv"):
            with open(path, newline="", encoding="utf-8", errors="ignore") as f:
                reader = csv.reader(f)
                header = next(reader, [])
                rows = sum(1 for _ in reader)
            item.update({"columns": header, "rows": rows})
            with open(path + ".hint", "w", encoding="utf-8") as h:
                h.write(f"CSV file {path}: {rows} rows, columns={header}\n")
        files.append(item)
    payload = {"status": "ok", "files": files}
    with open("reports/data_catalog.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    return {"status": "ok", "catalog_path": "reports/data_catalog.json", "files": files}


def download():
    s = slug()
    if not s:
        return {"status": "failed", "error": "competition slug missing in params/autokaggle.yml"}
    if mode() == "offline":
        return {"status": "ok", "mode": "offline", "catalog": catalog()}
    os.makedirs("data/raw", exist_ok=True)
    res = run_kaggle(["competitions", "download", "-c", s, "-p", "data/raw"], timeout=600)
    if res.get("status") != "ok":
        return res
    for name in os.listdir("data/raw"):
        if name.endswith(".zip"):
            with zipfile.ZipFile(os.path.join("data/raw", name)) as z:
                z.extractall("data/raw")
    return {"status": "ok", "download": res, "catalog": catalog()}


def submit(path, message):
    s = slug()
    if not s:
        return {"status": "failed", "error": "competition slug missing"}
    if mode() == "offline":
        return {"status": "ok", "dry_run": True, "message": "offline mode submit skipped"}
    if not path or not os.path.exists(path):
        return {"status": "failed", "error": f"submission not found: {path}"}
    return run_kaggle(["competitions", "submit", "-c", s, "-f", path, "-m", message], timeout=300)


def submissions():
    s = slug()
    if not s:
        return {"status": "failed", "error": "competition slug missing"}
    if mode() == "offline":
        return {
            "status": "ok",
            "mode": "offline",
            "submissions": [],
            "polled_at": time.time(),
        }
    res = run_kaggle(["competitions", "submissions", "-c", s], timeout=120)
    res["polled_at"] = time.time()
    return res


def main():
    try:
        args = read_args()
        action = args.get("action")
        if action == "catalog":
            print(json.dumps(catalog()))
        elif action == "download":
            print(json.dumps(download()))
        elif action == "submit":
            print(json.dumps(submit(args.get("submission_path"), args.get("message", "autokaggle"))))
        elif action == "submissions":
            print(json.dumps(submissions()))
        elif action == "inspect":
            print(json.dumps({"status": "ok", "slug": slug(), "mode": mode(), "params_path": PARAMS}))
        else:
            print(json.dumps({"status": "failed", "error": f"unknown action: {action}"}))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)}))


if __name__ == "__main__":
    main()
