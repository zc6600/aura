# 4. 创建训练代码与实验账本

本章创建最小训练闭环，让 agent 可以训练候选、生成 submission、记录 registry。

## 4.1 创建 offline fixture

真实比赛下载前，先用离线数据跑通自动循环。

创建 `data/raw/train.csv`：

```csv
id,x1,x2,target
1,0.1,1.0,0
2,0.2,0.9,0
3,0.8,0.1,1
4,0.9,0.2,1
5,0.4,0.7,0
6,0.7,0.3,1
```

创建 `data/raw/test.csv`：

```csv
id,x1,x2
7,0.15,0.95
8,0.85,0.15
9,0.45,0.55
```

创建 `data/raw/sample_submission.csv`：

```csv
id,target
7,0
8,0
9,0
```

## 4.2 创建数据读取模块

创建 `src/data.py`：

```python
# @aura-hint: AutoKaggle data module. Keep train/test/sample submission alignment stable.
import csv
import os

TRAIN = "data/raw/train.csv"
TEST = "data/raw/test.csv"
SAMPLE = "data/raw/sample_submission.csv"

def read_csv_dicts(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

def load_data():
    train = read_csv_dicts(TRAIN)
    test = read_csv_dicts(TEST)
    sample = read_csv_dicts(SAMPLE)
    return train, test, sample

def feature_columns(rows):
    ignore = {"id", "target"}
    return [c for c in rows[0].keys() if c not in ignore]

def as_float_matrix(rows, cols):
    return [[float(r[c]) for c in cols] for r in rows]

def target(rows):
    return [float(r["target"]) for r in rows]
```

## 4.3 创建 metric

创建 `src/metric.py`：

```python
# @aura-hint: AutoKaggle metric module. Update only before validation is frozen.
def accuracy_from_probs(y_true, y_prob):
    correct = 0
    for y, p in zip(y_true, y_prob):
        pred = 1.0 if p >= 0.5 else 0.0
        if pred == y:
            correct += 1
    return correct / max(1, len(y_true))
```

## 4.4 创建 baseline 训练

创建 `src/train_candidate.py`：

```python
#!/usr/bin/env python3
# @aura-hint: Train exactly one AutoKaggle candidate and write report/submission. Agent may create variants under experiments/.
import argparse
import json
import math
import os
import time

from ak_registry import record
from data import as_float_matrix, feature_columns, load_data, target
from metric import accuracy_from_probs

def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-x))

def simple_score(row):
    # A deterministic toy model for the tutorial. Real competitions can replace this.
    return sigmoid(4.0 * (row[0] - row[1]))

def write_submission(path, sample_rows, probs):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("id,target\n")
        for row, p in zip(sample_rows, probs):
            f.write(f"{row['id']},{p:.8f}\n")

def registry_record(run_id, payload):
    # 写入 Aura registry 兼容的 SQLite schema，避免额外 SDK 依赖。
    return record(run_id, payload)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default=f"candidate_{int(time.time())}")
    parser.add_argument("--hypothesis", default="baseline deterministic score")
    args = parser.parse_args()

    train, test, sample = load_data()
    cols = feature_columns(train)
    x_train = as_float_matrix(train, cols)
    y = target(train)
    train_probs = [simple_score(r) for r in x_train]
    cv = accuracy_from_probs(y, train_probs)

    x_test = as_float_matrix(test, cols)
    test_probs = [simple_score(r) for r in x_test]
    sub_path = f"submissions/{args.run_id}.csv"
    write_submission(sub_path, sample, test_probs)

    os.makedirs("reports", exist_ok=True)
    report = {
        "run_id": args.run_id,
        "hypothesis": args.hypothesis,
        "metric_name": "accuracy",
        "cv_score": cv,
        "cv_std": 0.0,
        "higher_is_better": True,
        "model_family": "toy_baseline",
        "submission_path": sub_path,
        "changed_files": ["src/train_candidate.py"],
        "artifacts": {"report": f"reports/{args.run_id}.json"}
    }
    with open(f"reports/{args.run_id}.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    rec = registry_record(args.run_id, report)
    print(json.dumps({"status": "ok", "report": report, "registry": rec}, indent=2))

if __name__ == "__main__":
    main()
```

运行：

```bash
python src/train_candidate.py --run-id baseline_001
aura kernel run_call aura.registry.best '{}'
```

推荐把 `train_candidate.py` 视为生成 candidate 的脚本层，而不是恢复状态的事实源。跨中断真正需要记住的恢复信息，直接通过 `RunRegistry` 写入内置实验账本中。在 Agent 执行 `anchor_submit` 时，Aura 引擎会自动关联对应的物理状态与检验结果。

## 4.5 创建 submission verifier

Ralph loop 和 submit guard 都会用这个脚本。

创建 `src/verify_submission.py`：

```python
#!/usr/bin/env python3
import argparse
import csv
import json
import os
import sys

from ak_registry import get

SAMPLE = "data/raw/sample_submission.csv"

def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.reader(f))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--submission", required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    problems = []
    if not os.path.exists(args.submission):
        problems.append(f"submission missing: {args.submission}")
    if not os.path.exists(SAMPLE):
        problems.append(f"sample submission missing: {SAMPLE}")

    if not problems:
        sample = read_csv(SAMPLE)
        sub = read_csv(args.submission)
        if sample[0] != sub[0]:
            problems.append("columns do not match sample submission")
        if len(sample) != len(sub):
            problems.append("row count does not match sample submission")
        if [r[0] for r in sample[1:]] != [r[0] for r in sub[1:]]:
            problems.append("id order does not match sample submission")
        if any(any(c == "" for c in row) for row in sub[1:]):
            problems.append("submission contains missing values")

    if not problems:
        run_data = get(args.run_id)
        if not run_data or run_data.get("cv_score") is None:
            problems.append("run has no recorded CV score")

    result = {"completed": len(problems) == 0, "problems": problems}
    os.makedirs("reports", exist_ok=True)
    with open(f"reports/ralph_verify_{args.run_id}.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(json.dumps(result))
    sys.exit(0 if result["completed"] else 1)

if __name__ == "__main__":
    main()
```

## 4.6 验证 dry-run guard

```bash
aura kernel run_call ak_submit_guard '{"action":"validate","submission_path":"submissions/baseline_001.csv","run_id":"baseline_001","dry_run":true}'
```

此时如果 registry 还没有关联 Ralph `result.json`，guard 将会拒绝真实提交。在接下来的章节中，我们会把 `verify_submission.py` 声明在 `workflow.yml` 的 stage `ralph` 配置下。在 Agent 调用 `anchor_submit` 时，Aura 引擎会自动拉起 Ralph 物理验证并在通过后自动在内置账本中为本次 Run 关联 `ralph_result_path`，极大地简化了实验管理流程。
