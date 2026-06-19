# 6. 直接用 Ralph Loop 做提交前 verifier

Ralph loop 已经原生支持物理 verifier，不需要额外 wrapper。

正确流程是：

```text
train candidate
  ↓
ak_run_registry record
  ↓
aura kernel ralph --verify "python src/verify_submission.py ..."
  ↓
如果 Ralph 返回 completed，取 stdout 中的 result_path
  ↓
调用 ak_run_registry attach_ralph 关联 result_path
  ↓
ak_submit_guard validate / submit
```

新版 Aura 的 Ralph loop 会持久化结构化结果：

```text
.aura-workspace/state/ralph/runs/<ralph_run_id>/result.json
```

所以 AutoKaggle 不再需要 `ralph_verified` 布尔桥接。`ak_submit_guard` 应检查这个 result artifact：

- `status == "completed"`
- `verification.passed == true`
- `verification.command` 包含当前 `submission_path` 和 `run_id`
- `result.json` 修改时间晚于 submission 文件修改时间

## 6.1 创建 Ralph 提示词

创建 `prompts/ralph/ralph_system.md`：

```markdown
# AutoKaggle Ralph Developer

You are verifying a Kaggle submission candidate before it can be submitted.

Your job:

- Read the requested submission file and related report.
- Run the verify command.
- If verification fails, make the smallest necessary fix.
- Do not change the competition metric, fold strategy, or sample submission format.
- Do not submit to Kaggle.
- Stop only when the verify command passes.
```

创建 `prompts/ralph/critic_rules.md`：

```markdown
# AutoKaggle Critic Rules

Return completed=true only if all are true:

- The submission exists.
- The columns exactly match sample_submission.csv.
- The row count exactly matches sample_submission.csv.
- The ID order exactly matches sample_submission.csv.
- There are no missing prediction values.
- The run exists in ak_run_registry with a CV score.
- The verification did not modify unrelated experiment files.
- No Kaggle submission was performed by the verifier.

Return actionable advice if any check fails.
```

## 6.2 直接运行 Ralph verifier

先训练一个候选：

```bash
python src/train_candidate.py --run-id baseline_001
```

然后直接运行 Ralph：

```bash
aura kernel ralph \
  --goal "Verify AutoKaggle run baseline_001 before submission. Submission path: submissions/baseline_001.csv. Do not submit to Kaggle." \
  --verify "python src/verify_submission.py --submission submissions/baseline_001.csv --run-id baseline_001" \
  --max-steps 5
```

`aura kernel ralph` 的 stdout 会输出类似：

```json
{
  "status": "completed",
  "run_id": "20260617...",
  "result_path": ".aura-workspace/state/ralph/runs/20260617.../result.json",
  "verification": {
    "mode": "physical",
    "passed": true,
    "command": "python src/verify_submission.py --submission submissions/baseline_001.csv --run-id baseline_001",
    "exit_code": 0
  }
}
```

如果 `status` 不是 `completed`，不要提交。让 Ralph 根据 verifier 失败输出修复，或者停止交给用户。

## 6.3 关联 Ralph result artifact

Ralph 成功后，把 stdout 中的 `result_path` 关联到 registry：

```bash
aura kernel run_call ak_run_registry \
  '{"action":"attach_ralph","run_id":"baseline_001","payload":{"ralph_result_path":".aura-workspace/state/ralph/runs/<ralph_run_id>/result.json"}}'
```

再检查：

```bash
aura kernel run_call ak_run_registry '{"action":"get","run_id":"baseline_001"}'
```

registry 中应看到：

```json
"ralph_result_path": ".aura-workspace/state/ralph/runs/<ralph_run_id>/result.json"
```

## 6.4 接入 submit guard

现在运行：

```bash
aura kernel run_call ak_submit_guard \
  '{"action":"validate","submission_path":"submissions/baseline_001.csv","run_id":"baseline_001","dry_run":true}'
```

如果 submission 格式正确，并且 `ralph_result_path` 指向一个通过的 Ralph result artifact，guard 应返回 `status: "ok"`，或在预算不足时返回 `wait_required`。

## 6.5 Agent 自动调用规则

在自动循环里，agent 应按这个顺序：

```text
python src/train_candidate.py --run-id <run_id> --hypothesis <hypothesis>
aura kernel ralph --goal "Verify AutoKaggle run <run_id>..." --verify "python src/verify_submission.py --submission <submission_path> --run-id <run_id>" --max-steps 5
aura kernel run_call ak_run_registry '{"action":"attach_ralph", ...}'
aura kernel run_call ak_submit_guard '{"action":"validate", ...}'
```

Ralph verifier 只负责提交前质量门禁，不负责决定下一轮实验方向。下一轮实验方向仍由主 agent 根据 registry 和 leaderboard 反馈决定。
