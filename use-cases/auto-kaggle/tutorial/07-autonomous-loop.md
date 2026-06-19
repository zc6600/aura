# 7. 启动全自动刷榜循环

本章把训练、Ralph verifier、submit guard、等待、提交、poll leaderboard 串成 agent 可执行的完整循环。

## 7.1 创建下一轮实验建议脚本

创建 `src/select_next_experiment.py`：

```python
#!/usr/bin/env python3
import json
import os
import sqlite3
import time

REGISTRY = "experiments/runs.sqlite"

def main():
    if not os.path.exists(REGISTRY):
        print(json.dumps({
            "status": "ok",
            "next_run_id": f"baseline_{int(time.time())}",
            "hypothesis": "Create the first baseline candidate."
        }))
        return

    conn = sqlite3.connect(REGISTRY)
    rows = conn.execute(
        "SELECT run_id, cv_score, public_score, hypothesis FROM runs ORDER BY created_at DESC"
    ).fetchall()
    conn.close()

    round_id = len(rows) + 1
    if not rows:
        hypothesis = "Create a stable baseline candidate."
    else:
        hypothesis = "Try one conservative feature/model improvement over the best recorded CV run."

    print(json.dumps({
        "status": "ok",
        "completed_runs": len(rows),
        "recent_runs": rows[:5],
        "next_run_id": f"candidate_{round_id}_{int(time.time())}",
        "hypothesis": hypothesis
    }, default=str))

if __name__ == "__main__":
    main()
```

## 7.2 创建 polling 脚本

创建 `src/poll_submission.py`：

```python
#!/usr/bin/env python3
import argparse
import json
import subprocess
import time

def call_tool(tool_path, payload):
    proc = subprocess.run(
        ["python", tool_path],
        input=json.dumps(payload),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
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
        res = call_tool("tools/ak_competition/logic.py", {"action": "submissions"})
        last = res
        text = json.dumps(res)
        if "complete" in text.lower() or "submitted" in text.lower():
            call_tool("tools/ak_run_registry/logic.py", {
                "action": "attach_lb",
                "run_id": args.run_id,
                "payload": {
                    "lb_status": "polled",
                    "kaggle_submission_id": None,
                    "public_score": None,
                    "raw": res
                }
            })
            print(json.dumps({"status": "ok", "poll": res}))
            return
        time.sleep(args.sleep_seconds)
    print(json.dumps({"status": "timeout", "last": last}))

if __name__ == "__main__":
    main()
```

真实实现中可以把 Kaggle submissions 表格解析成具体 score。教程版先把原始 poll 结果写入 registry，确保反馈闭环存在。

## 7.3 Workflow run 契约

第 2 章已经把原来的长 agent goal 写入 `workflow.yml` 的 `run.goal`。这个 goal 仍然表达完整 AutoKaggle 循环：

- 读取 `params/autokaggle.yml`。
- 遵守 stop conditions。
- 使用 `ak_run_registry` 作为事实源。
- 每次提交决策都通过 `ak_submit_guard`。
- 需要等待时调用 `timer`，等待后重试同一个 candidate 和 guard action。
- 真实提交前运行 Ralph verifier。
- Ralph 通过后用 `ak_run_registry attach_ralph` 关联 `result_path`。
- 提交或 dry-run 后 poll feedback 并写回 registry。
- 禁止 raw Kaggle submit shell 命令。

`workflow.yml` 不是替代这些规则，而是让 Aura 能在运行前检查 params、Garden、Skill、prompts、tools 和 anchors 是否齐全，并用同一份契约启动 agent。

## 7.4 启动 workflow

```bash
aura workflow doctor
aura workflow run
```

如果你想给 agent 更多步数：

```bash
aura workflow run --max-steps 120
```

## 7.4.1 用 anchor 保存轻量 runtime

推荐把恢复信息和 milestone 一起写进 `anchor_submit`，而不是单独维护一套重型状态机。做法是：

- tool 返回一个很短的 `anchor_runtime_update` 对象；
- agent 写一段短 `summary`；
- agent 调用 `anchor_submit` 时把两者合并提交。

示例：

```json
{
  "anchor_id": "20_submission_loop_started",
  "summary": "Candidate candidate_004 passed verification. Guard returned wait_required, so resume by retrying the same candidate after cooldown.",
  "selected_next": "20_submission_loop_started",
  "anchor_runtime_update": {
    "phase": "waiting_guard",
    "active_run_id": "candidate_004",
    "active_submission_path": "submissions/candidate_004.csv",
    "resume_action": "retry_guard_for_same_candidate",
    "resume_at": "2026-06-18T00:00:00Z",
    "tool_note": "guard wait 900s for candidate_004"
  }
}
```

这里的约束是：

- `summary` 保持短小，只写对后续恢复最重要的信息；
- `anchor_runtime_update` 只放结构化恢复字段；
- `tool_note` 也应保持很短，避免 anchor event 膨胀。

## 7.5 自动等待行为

当 `ak_submit_guard` 返回：

```json
{
  "status": "wait_required",
  "reason": "cooldown_active",
  "wait_seconds": 1800,
  "wait_chunk_seconds": 900
}
```

agent 应调用：

```json
{
  "seconds": 900
}
```

也就是：

```bash
aura kernel run_call timer '{"seconds":900}'
```

然后重新调用：

```bash
aura kernel run_call ak_submit_guard '{"action":"validate","submission_path":"submissions/candidate.csv","run_id":"candidate_..."}'
```

如果还需要等待，继续 timer。这样不会因为 Kaggle 提交上限而失败，只会阻塞到可提交窗口。

## 7.6 真实提交开关

真实提交前，用户必须改 `params/autokaggle.yml`：

```yaml
competition:
  rules_accepted: true

submission:
  allow_submit: true
  auto_wait: true
  auto_poll_leaderboard: true
```

否则 `ak_submit_guard submit` 只会 dry-run。

## 7.7 长时间运行建议

长时间刷榜建议用 `aura agent` 而不是一次性 shell 脚本，因为 Aura 会记录 state、工具输出和总结。

但非常长的等待会受到 tool timeout 影响，所以使用分块等待：

```yaml
submission:
  max_wait_chunk_seconds: 900
```

guard 每次最多让 agent 等 900 秒，agent 醒来后重新检查窗口。
