# 3. 实现确定性工具

本章介绍 Aura 内置的实验账本服务，并创建两个 AutoKaggle 自定义工具：

- `Aura Built-in Registry`：内置实验账本（通过 workflow.yml 声明配置，无需编写 SQLite 胶水代码）。
- `ak_competition`：Kaggle CLI 封装。
- `ak_submit_guard`：提交前门禁、等待决策、真实提交入口。

这些工具是稳定 workflow 的核心。agent 不能直接调用 shell 执行 submit，必须通过 `ak_submit_guard`。

从本章开始，建议所有参与恢复语义的 tool 统一支持一个可选输出字段：

```json
{
  "anchor_runtime_update": {
    "phase": "waiting_guard",
    "active_run_id": "candidate_004",
    "active_submission_path": "submissions/candidate_004.csv",
    "active_submission_id": "12345",
    "resume_action": "retry_guard_for_same_candidate",
    "resume_at": "2026-06-18T00:00:00Z",
    "tool_note": "guard wait 900s for candidate_004"
  }
}
```

约定：

- tool 只写短小、结构化的恢复事实；
- agent 自己写 `summary`；
- 调用 `anchor_submit` 时，把 `summary + selected_next + anchor_runtime_update` 一起提交；
- 最新的 anchor event 就是当前 workflow 的轻量 runtime snapshot。

## 3.1 实验账本服务（Built-in Registry）

在以前的设计中，我们需要手动编写 `tools/ak_run_registry` 工具，在其中用 Python 手动创建 SQLite 表结构并处理 SQL 的增删改查。现在，Aura 引擎已经提供框架级的 **Built-in Registry** 服务。

### 1. 在 `workflow.yml` 中声明账本
你只需要在工作流文件中添加 `registry` 声明即可：

```yaml
registry:
  db_path: ".aura-workspace/state/experiments.db"
  metrics:
    - name: cv_score
      higher_is_better: true
```

Aura 将会自动初始化该路径下的 SQLite 数据库并创建适合比赛记录的 `runs` 数据表。

### 2. 内置账本工具
引擎将自动向 Agent 加载以下两个内核工具：
*   `aura.registry.record`：记录实验运行，支持传入 `run_id`、`cv_score`、`hypothesis`、`model_family`、`params`、`changed_files`、`artifacts` 和 `notes` 等。
*   `aura.registry.best`：查询目前 CV 表现最好的运行记录。

Agent 或训练脚本可以直接通过这组内置工具读写账本，无需再编写任何数据库连接与查询的胶水代码。

## 3.2 工具 2：ak_competition

创建目录：

```bash
mkdir -p tools/ak_competition
```

创建 `tools/ak_competition/manifest.json`：

```json
{
  "name": "ak_competition",
  "description": "Controlled Kaggle CLI wrapper for download, submit, and submission polling.",
  "runtime": "python3",
  "entry": "logic.py",
  "auto_load": true,
  "timeout": 120,
  "agent_can_modify_timeout": true,
  "permissions": {
    "file_system": "read-write",
    "allow_paths": ["./data", "./reports", "./submissions", "./params", "./experiments"],
    "shell": false
  },
  "input_schema": {
    "type": "object",
    "properties": {
      "action": { "type": "string" },
      "submission_path": { "type": "string" },
      "message": { "type": "string" },
      "run_id": { "type": "string" }
    },
    "required": ["action"]
  },
  "memory": {
    "retention": "ephemeral",
    "summarize": true,
    "max_steps": 5
  }
}
```

创建 `tools/ak_competition/logic.py`：

```python
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
    return open(PARAMS, "r", encoding="utf-8").read()

def param_value(text, key, default=""):
    # Minimal parser for this tutorial. Production can use PyYAML if available.
    for line in text.splitlines():
        if line.strip().startswith(key + ":"):
            return line.split(":", 1)[1].strip().strip('"').strip("'")
    return default

def slug():
    text = read_params_text()
    val = param_value(text, "slug")
    if val:
        return val
    # Fallback for nested YAML shape used in the tutorial.
    for line in text.splitlines():
        if "slug:" in line:
            return line.split(":", 1)[1].strip().strip('"').strip("'")
    return ""

def run_kaggle(args, timeout=120):
    if not shutil.which("kaggle"):
        return {"status": "failed", "error": "kaggle CLI not found"}
    proc = subprocess.run(
        ["kaggle"] + args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout
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
        if not os.path.isfile(path):
            continue
        item = {"path": path, "bytes": os.path.getsize(path)}
        if name.endswith(".csv"):
            with open(path, newline="", encoding="utf-8", errors="ignore") as f:
                reader = csv.reader(f)
                header = next(reader, [])
                rows = sum(1 for _ in reader)
            item.update({"columns": header, "rows": rows})
            with open(path + ".hint", "w", encoding="utf-8") as h:
                h.write(f"CSV file {path}: {rows} rows, columns={header}\\n")
        files.append(item)
    with open("reports/data_catalog.json", "w", encoding="utf-8") as f:
        json.dump({"status": "ok", "files": files}, f, indent=2)
    return {"status": "ok", "catalog_path": "reports/data_catalog.json", "files": files}

def download():
    s = slug()
    if not s:
        return {"status": "failed", "error": "competition slug missing in params/autokaggle.yml"}
    os.makedirs("data/raw", exist_ok=True)
    res = run_kaggle(["competitions", "download", "-c", s, "-p", "data/raw"], timeout=600)
    if res.get("status") != "ok":
        return res
    for name in os.listdir("data/raw"):
        if name.endswith(".zip"):
            with zipfile.ZipFile(os.path.join("data/raw", name)) as z:
                z.extractall("data/raw")
    cat = catalog()
    return {"status": "ok", "download": res, "catalog": cat}

def submit(path, message):
    s = slug()
    if not s:
        return {"status": "failed", "error": "competition slug missing"}
    if not path or not os.path.exists(path):
        return {"status": "failed", "error": f"submission not found: {path}"}
    return run_kaggle(["competitions", "submit", "-c", s, "-f", path, "-m", message], timeout=300)

def submissions():
    s = slug()
    if not s:
        return {"status": "failed", "error": "competition slug missing"}
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
            print(json.dumps({"status": "ok", "slug": slug(), "params_path": PARAMS}))
        else:
            print(json.dumps({"status": "failed", "error": f"unknown action: {action}"}))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)}))

if __name__ == "__main__":
    main()
```

创建 `tools/ak_competition/logic.py.hint`：

```text
Use ak_competition for Kaggle CLI operations. Never print or store Kaggle credentials. Submit only through ak_submit_guard.
```

推荐输出约定：

- `catalog` 完成后可把 phase 设为 `catalog_ready`
- `submissions` 应尽量返回最近一次 polling 的时间和 submission 绑定，并写进 `anchor_runtime_update`
- 真实 submit 不建议直接由 agent 调 `ak_competition submit`，而是只由 `ak_submit_guard submit` 内部调用

`submissions` 示例：

```json
{
  "status": "ok",
  "submissions": [
    {
      "submission_id": "12345",
      "status": "pending"
    }
  ],
  "polled_at": 1781700000,
  "anchor_runtime_update": {
    "phase": "polling_feedback",
    "active_submission_id": "12345",
    "resume_action": "attach_lb_feedback",
    "tool_note": "polled submission 12345"
  }
}
```

## 3.3 工具 3：ak_submit_guard

创建目录：

```bash
mkdir -p tools/ak_submit_guard
```

创建 `tools/ak_submit_guard/manifest.json`：

```json
{
  "name": "ak_submit_guard",
  "description": "Validate and submit Kaggle submissions with budget, cooldown, wait, and Ralph verifier gates.",
  "runtime": "python3",
  "entry": "logic.py",
  "auto_load": true,
  "timeout": 300,
  "agent_can_modify_timeout": true,
  "permissions": {
    "file_system": "read-write",
    "allow_paths": ["./data", "./submissions", "./experiments", "./reports", "./params"]
  },
  "input_schema": {
    "type": "object",
    "properties": {
      "action": { "type": "string" },
      "submission_path": { "type": "string" },
      "run_id": { "type": "string" },
      "dry_run": { "type": "boolean" },
      "ralph_report_path": { "type": "string" }
    },
    "required": ["action"]
  },
  "memory": {
    "retention": "ephemeral",
    "summarize": true,
    "max_steps": 5
  }
}
```

创建 `tools/ak_submit_guard/logic.py`：

```python
#!/usr/bin/env python3
import csv
import datetime as dt
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import time

REGISTRY = "experiments/runs.sqlite"
SAMPLE = "data/raw/sample_submission.csv"
EVENTS = "experiments/submit_events.jsonl"
PARAMS = "params/autokaggle.yml"

def read_args():
    raw = sys.stdin.read().strip()
    return json.loads(raw) if raw else {}

def read_text(path):
    return open(path, "r", encoding="utf-8").read() if os.path.exists(path) else ""

def cfg_bool(name, default=False):
    text = read_text(PARAMS)
    for line in text.splitlines():
        if line.strip().startswith(name + ":"):
            val = line.split(":", 1)[1].strip().lower()
            return val in ("true", "yes", "1")
    return default

def cfg_int(name, default):
    text = read_text(PARAMS)
    for line in text.splitlines():
        if line.strip().startswith(name + ":"):
            try:
                return int(line.split(":", 1)[1].strip())
            except Exception:
                return default
    return default

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def read_csv_shape(path):
    with open(path, newline="", encoding="utf-8", errors="ignore") as f:
        reader = csv.reader(f)
        header = next(reader, [])
        rows = list(reader)
    return header, rows

def load_events():
    if not os.path.exists(EVENTS):
        return []
    items = []
    with open(EVENTS, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                items.append(json.loads(line))
    return items

def append_event(event):
    os.makedirs(os.path.dirname(EVENTS), exist_ok=True)
    with open(EVENTS, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, sort_keys=True) + "\n")

def run_record(run_id):
    if not os.path.exists(REGISTRY):
        return None
    conn = sqlite3.connect(REGISTRY)
    row = conn.execute(
        "SELECT run_id, cv_score, submission_sha256, ralph_result_path FROM runs WHERE run_id=?",
        (run_id,)
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {"run_id": row[0], "cv_score": row[1], "submission_sha256": row[2], "ralph_result_path": row[3]}

def valid_ralph_result(result_path, submission_path, run_id):
    if not result_path:
        return False, "missing_ralph_result_path"
    if not os.path.exists(result_path):
        return False, "ralph_result_not_found"
    try:
        data = json.loads(open(result_path, "r", encoding="utf-8").read())
    except Exception:
        return False, "ralph_result_invalid_json"
    if data.get("status") != "completed":
        return False, "ralph_not_completed"
    verification = data.get("verification") or {}
    if verification.get("passed") is not True:
        return False, "ralph_verification_not_passed"
    command = str(verification.get("command") or "")
    if submission_path and submission_path not in command:
        return False, "ralph_command_missing_submission"
    if run_id and run_id not in command:
        return False, "ralph_command_missing_run_id"
    try:
        if os.path.getmtime(result_path) < os.path.getmtime(submission_path):
            return False, "ralph_result_older_than_submission"
    except Exception:
        pass
    return True, "ok"

def budget_status():
    daily_budget = cfg_int("daily_budget", 3)
    cooldown_minutes = cfg_int("cooldown_minutes", 30)
    max_chunk = cfg_int("max_wait_chunk_seconds", 900)
    now = time.time()
    events = [e for e in load_events() if e.get("event_type") == "real_submit"]
    today = dt.datetime.utcnow().strftime("%Y-%m-%d")
    today_events = [e for e in events if str(e.get("created_at", "")).startswith(today)]
    if len(today_events) >= daily_budget:
        tomorrow = dt.datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0) + dt.timedelta(days=1)
        wait_seconds = max(60, int((tomorrow - dt.datetime.utcnow()).total_seconds()))
        return {"ok": False, "reason": "daily_budget_exhausted", "wait_seconds": wait_seconds, "wait_chunk_seconds": min(wait_seconds, max_chunk)}
    if events:
        last = max(e.get("created_ts", 0) for e in events)
        ready_at = last + cooldown_minutes * 60
        if now < ready_at:
            wait_seconds = int(ready_at - now)
            return {"ok": False, "reason": "cooldown_active", "wait_seconds": wait_seconds, "wait_chunk_seconds": min(wait_seconds, max_chunk)}
    return {"ok": True, "reason": "ready", "wait_seconds": 0, "wait_chunk_seconds": 0}

def validate(args):
    path = args.get("submission_path")
    run_id = args.get("run_id")
    checks = {}
    if not path or not os.path.exists(path):
        return {"status": "failed", "error": f"submission not found: {path}"}
    if not os.path.exists(SAMPLE):
        return {"status": "failed", "error": f"sample submission not found: {SAMPLE}"}
    sample_header, sample_rows = read_csv_shape(SAMPLE)
    sub_header, sub_rows = read_csv_shape(path)
    checks["columns"] = "ok" if sub_header == sample_header else "failed"
    checks["rows"] = "ok" if len(sub_rows) == len(sample_rows) else "failed"
    if sample_header:
        sample_ids = [r[0] for r in sample_rows]
        sub_ids = [r[0] for r in sub_rows]
        checks["id_alignment"] = "ok" if sample_ids == sub_ids else "failed"
        checks["duplicate_id"] = "ok" if len(set(sub_ids)) == len(sub_ids) else "failed"
    checks["missing_values"] = "ok" if all(all(c != "" for c in row) for row in sub_rows) else "failed"
    digest = sha256_file(path)
    checks["sha256"] = digest
    if run_id:
        rec = run_record(run_id)
        checks["registry"] = "ok" if rec and rec.get("cv_score") is not None else "failed"
        ralph_ok, ralph_reason = valid_ralph_result(rec.get("ralph_result_path") if rec else None, path, run_id)
        checks["ralph_result"] = "ok" if ralph_ok else ralph_reason
    budget = budget_status()
    checks["budget"] = "ok" if budget["ok"] else budget["reason"]
    failed = [k for k, v in checks.items() if v == "failed" or (k == "ralph_result" and v != "ok")]
    if failed:
        return {"status": "failed", "failed_checks": failed, "checks": checks}
    if not budget["ok"]:
        return {"status": "wait_required", "checks": checks, **budget}
    return {"status": "ok", "checks": checks, "submission_sha256": digest}

def submit(args):
    dry_run = bool(args.get("dry_run", False))
    allow_submit = cfg_bool("allow_submit", False)
    valid = validate(args)
    if valid.get("status") != "ok":
        return valid
    if dry_run or not allow_submit:
        valid["dry_run"] = True
        valid["message"] = "Submission validated but not sent because dry_run=true or allow_submit=false."
        return valid
    path = args["submission_path"]
    run_id = args.get("run_id", "unknown")
    msg = f"autokaggle {run_id}"
    proc = subprocess.run(
        ["python", "tools/ak_competition/logic.py"],
        input=json.dumps({"action": "submit", "submission_path": path, "message": msg}),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    try:
        res = json.loads(proc.stdout)
    except Exception:
        res = {"status": "failed", "stdout": proc.stdout[-2000:], "stderr": proc.stderr[-2000:]}
    if res.get("status") == "ok":
        append_event({"event_type": "real_submit", "run_id": run_id, "created_at": dt.datetime.utcnow().isoformat() + "Z", "created_ts": time.time(), "submission_path": path})
    return {"status": res.get("status", "failed"), "submit_result": res}

def main():
    try:
        args = read_args()
        action = args.get("action")
        if action == "validate":
            print(json.dumps(validate(args)))
        elif action == "submit":
            print(json.dumps(submit(args)))
        elif action == "budget":
            print(json.dumps({"status": "ok", **budget_status()}))
        else:
            print(json.dumps({"status": "failed", "error": f"unknown action: {action}"}))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)}))

if __name__ == "__main__":
    main()
```

创建 `tools/ak_submit_guard/logic.py.hint`：

```text
ak_submit_guard is the only permitted real submission path. If it returns wait_required, call timer with wait_chunk_seconds and then retry the same guard action.
```

推荐输出约定：

- `validate` 成功时，返回当前 candidate 的 `run_id` 与 `submission_path`
- `wait_required` 时，明确给出 `resume_action`、`resume_at` 和一句短 `tool_note`
- `submit` 成功时，把真实的 `submission_id` 或提交回执写回 `anchor_runtime_update`

`validate` 返回 `wait_required` 示例：

```json
{
  "status": "wait_required",
  "checks": {
    "columns": "ok",
    "rows": "ok",
    "ralph_result": "ok",
    "budget": "cooldown_active"
  },
  "wait_seconds": 1800,
  "wait_chunk_seconds": 900,
  "anchor_runtime_update": {
    "phase": "waiting_guard",
    "active_run_id": "baseline_001",
    "active_submission_path": "submissions/baseline_001.csv",
    "resume_action": "retry_guard_for_same_candidate",
    "resume_at": "2026-06-18T00:00:00Z",
    "tool_note": "guard wait 900s for baseline_001"
  }
}
```

`submit` 成功示例：

```json
{
  "status": "ok",
  "submit_result": {
    "status": "ok",
    "submission_id": "12345"
  },
  "anchor_runtime_update": {
    "phase": "submission_sent",
    "active_run_id": "baseline_001",
    "active_submission_path": "submissions/baseline_001.csv",
    "active_submission_id": "12345",
    "resume_action": "poll_submission_feedback",
    "tool_note": "submission 12345 sent for baseline_001"
  }
}
```

## 3.4 验证工具发现

```bash
aura tools list
aura kernel run_call ak_run_registry '{"action":"init"}'
aura kernel run_call ak_competition '{"action":"inspect"}'
aura kernel run_call ak_submit_guard '{"action":"budget"}'
```

如果工具不可见，检查它们是否位于 workspace 根目录的 `tools/` 下，而不是 `.aura-workspace/tools/` 或源码仓库的 `use-cases/` 下。
