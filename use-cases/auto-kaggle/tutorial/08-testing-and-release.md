# 8. 测试、调试与发布

## 8.1 最小 smoke test

在一个新 workspace 中执行：

```bash
aura tools list
aura skill list
aura garden list
aura garden status
aura anchor status
aura workflow doctor
aura workflow status
aura kernel observe
```

应看到：

- `ak_competition`
- `ak_run_registry`
- `ak_submit_guard`
- `timer`
- `auto-kaggle` skill
- `auto-kaggle` garden
- anchor 节点详情和推荐后继节点
- `workflow.yml` doctor 通过

## 8.2 离线训练测试

```bash
aura kernel run_call ak_run_registry '{"action":"init"}'
aura kernel run_call ak_competition '{"action":"catalog"}'
python src/train_candidate.py --run-id baseline_001
aura kernel run_call ak_run_registry '{"action":"best","top_k":3}'
```

期望：

- `reports/data_catalog.json` 存在。
- `submissions/baseline_001.csv` 存在。
- `experiments/runs.sqlite` 中有 baseline。

## 8.3 Ralph verifier 测试

```bash
aura kernel ralph \
  --goal "Verify AutoKaggle run baseline_001 before submission. Submission path: submissions/baseline_001.csv. Do not submit to Kaggle." \
  --verify "python src/verify_submission.py --submission submissions/baseline_001.csv --run-id baseline_001" \
  --max-steps 5

# Use the result_path from the JSON printed by the previous command.
aura kernel run_call ak_run_registry \
  '{"action":"attach_ralph","run_id":"baseline_001","payload":{"ralph_result_path":".aura-workspace/state/ralph/runs/<ralph_run_id>/result.json"}}'

aura kernel run_call ak_run_registry '{"action":"get","run_id":"baseline_001"}'
```

期望 registry 中有 `ralph_result_path`。

## 8.4 Submit guard 测试

```bash
aura kernel run_call ak_submit_guard \
  '{"action":"validate","submission_path":"submissions/baseline_001.csv","run_id":"baseline_001","dry_run":true}'
```

期望 `status` 为 `ok`。

制造错误列名：

```bash
cp submissions/baseline_001.csv submissions/bad_columns.csv
python - <<'PY'
p = "submissions/bad_columns.csv"
s = open(p).read()
s = s.replace("target", "wrong_target", 1)
open(p, "w").write(s)
PY

aura kernel run_call ak_submit_guard \
  '{"action":"validate","submission_path":"submissions/bad_columns.csv","run_id":"baseline_001","dry_run":true}'
```

期望 `status` 为 `failed`，`failed_checks` 包含 `columns`。

## 8.5 Wait 行为测试

把 `params/autokaggle.yml` 中设置为：

```yaml
submission:
  daily_budget: 0
  max_wait_chunk_seconds: 2
```

运行：

```bash
aura kernel run_call ak_submit_guard \
  '{"action":"validate","submission_path":"submissions/baseline_001.csv","run_id":"baseline_001","dry_run":true}'
```

期望返回：

```json
{
  "status": "wait_required",
  "wait_chunk_seconds": 2
}
```

然后验证 timer：

```bash
aura kernel run_call timer '{"seconds":2}'
```

## 8.6 自动循环 dry-run 测试

保持：

```yaml
submission:
  allow_submit: false
```

运行：

```bash
aura workflow run --max-steps 30
```

期望：

- agent 不真实提交。
- 至少生成一个 candidate。
- registry 记录 run。
- guard dry-run 通过或给出明确等待/失败原因。

## 8.7 真实 Kaggle 前检查

真实提交前必须人工确认：

```bash
kaggle competitions files -c <slug>
kaggle competitions submissions -c <slug>
```

并修改参数：

```yaml
competition:
  rules_accepted: true

submission:
  allow_submit: true
```

然后先单独 dry-run：

```bash
aura kernel run_call ak_submit_guard \
  '{"action":"submit","submission_path":"submissions/baseline_001.csv","run_id":"baseline_001","dry_run":true}'
```

确认无误后才让 agent 自动运行。

## 8.8 常见问题

### 工具不可见

检查工具是否在 workspace 根目录：

```bash
find tools -maxdepth 2 -name manifest.json
aura tools list
```

### Ralph result 没有关联到 registry

检查：

```bash
aura kernel ralph \
  --goal "Verify AutoKaggle run baseline_001 before submission." \
  --verify "python src/verify_submission.py --submission submissions/baseline_001.csv --run-id baseline_001" \
  --max-steps 5

aura kernel run_call ak_run_registry \
  '{"action":"attach_ralph","run_id":"baseline_001","payload":{"ralph_result_path":".aura-workspace/state/ralph/runs/<ralph_run_id>/result.json"}}'
```

### Agent 不会等待

检查 `prompts/system/TOOLS.md` 和 garden 中是否写明：

```text
If guard returns wait_required, call timer with wait_chunk_seconds, then retry.
```

### Agent 直接 shell submit

加强 `prompts/system/TOOLS.md` 和 `skills/auto-kaggle/SKILL.md`：

```text
Never call raw Kaggle submit through shell. Only ak_submit_guard submit may perform real submission.
```

## 8.9 发布为 use-case

当教程中的文件稳定后，把它们整理成 `use-cases/auto-kaggle` 的可复制模板：

```text
use-cases/auto-kaggle/
├── scripts/bootstrap.py
├── tools/
├── skills/
├── garden/
├── template/
└── tutorial/
```

`bootstrap.py` 的职责是把教程中手动创建的文件复制到目标 workspace，并根据用户参数写入 `params/autokaggle.yml`。

## 8.10 完成标准

一个可发布的 AutoKaggle 教程必须满足：

- 用户只需要填写 `params/autokaggle.yml`。
- agent 能自动训练候选。
- Ralph verifier 能在提交前运行。
- submit guard 能阻止坏 submission。
- 达到提交上限时 agent 会调用 `timer` 等待。
- agent 能 poll Kaggle submission 结果。
- registry 能保存 CV、submission hash、verifier、LB feedback。
- dry-run 模式不需要 Kaggle token 也能完整跑通。
