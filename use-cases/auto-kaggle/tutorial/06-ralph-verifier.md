# 6. 直接用 Ralph Loop 做提交前 verifier

Aura 工作流引擎已经深度集成了 Ralph 物理验证器与内置账本服务，不需要额外的手动胶水代码。

正确流程是：

```text
train candidate
  ↓
aura.registry.record 记录实验
  ↓
Aura workflow.yml 声明 stage 的 ralph 属性
  ↓
当 Agent 提交对应 Anchor 时，引擎自动调用 Ralph 进行 verify_cmd 校验
  ↓
校验成功后，引擎自动将 Ralph result_path 关联到内置账本的运行记录中
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
- The run exists in the experiment registry with a CV score.
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

## 6.3 自动管理 Ralph 验证与账本记录

在 Aura 框架下，物理验证与内置账本是深度集成的。在工作流的 `workflow.yml` 中声明 stage 级别的 `ralph` 配置时，当 Agent 在提交对应的 Anchor 节点（如运行 `anchor_submit`）时，引擎会自动拉起指定的 `verify_cmd` 进行物理检验。

一旦物理检验通过，引擎会自动在 SQLite 账本的 `runs` 表中为最新的实验记录（例如 `baseline_001`）更新 `ralph_result_path` 字段，整个过程是**完全自动且隐式**的，无需开发者或 Agent 手动编写附加或关联的胶水指令。

你可以通过内置工具查询确认关联状态：

```bash
aura kernel run_call aura.registry.best '{}'
```

## 6.4 接入 submit guard

现在运行：

```bash
aura kernel run_call ak_submit_guard \
  '{"action":"validate","submission_path":"submissions/baseline_001.csv","run_id":"baseline_001","dry_run":true}'
```

如果 submission 格式正确，并且内置账本中的 `ralph_result_path` 指向一个通过的 Ralph result artifact，guard 将会返回 `status: "ok"`，或在预算/冷却不足时返回 `wait_required`。

## 6.5 Agent 自动循环执行规程

在自动迭代循环中，主 Agent 应当遵循如下运行顺序：

```text
1. 运行实验脚本：python src/train_candidate.py --run-id <run_id>
2. 执行物理验证并提交里程碑：aura kernel run_call anchor_submit '{"anchor_id":"验证节点ID", "summary":"..."}'
3. 通过提交门禁：aura kernel run_call ak_submit_guard '{"action":"validate", "submission_path":"...", "run_id":"..."}'
```

Aura 引擎会自动拦截并妥善串联起验证与日志链路。
