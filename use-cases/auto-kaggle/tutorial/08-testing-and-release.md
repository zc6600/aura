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
- 内置实验账本工具 (`aura.registry.record` / `aura.registry.best`)
- `ak_submit_guard`
- `timer`
- `auto-kaggle` skill
- `auto-kaggle` garden
- anchor 节点详情和推荐后继节点
- `workflow.yml` doctor 通过

## 8.2 离线训练测试

```bash
# 内置实验账本由 Aura 引擎自动初始化与管理，无需手动执行 init
aura kernel run_call ak_competition '{"action":"catalog"}'
python src/train_candidate.py --run-id baseline_001
aura kernel run_call aura.registry.best '{}'
```

期望：

- `reports/data_catalog.json` 存在。
- `submissions/baseline_001.csv` 存在。
- `.aura-workspace/state/experiments.db` 中有 baseline 记录。

## 8.3 Ralph verifier 测试

```bash
# 提交关联有 ralph 配置的验证阶段 anchor
# Aura 引擎会自动拉起 Ralph 物理验证并校验，通过后自动将验证状态与结果关联写入内置账本中
aura kernel run_call anchor_submit '{"anchor_id":"验证阶段ID", "summary":"Verify baseline run"}'

# 查看内置账本关联状态，确认 ralph_result_path 已被自动写入
aura kernel run_call aura.registry.best '{}'
```

期望内置账本中最新的记录已被自动更新关联上 `ralph_result_path`。

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

检查对应阶段的 `workflow.yml` 中是否正确配置了 `ralph.verify_cmd`。物理验证结果会在执行 `anchor_submit` 里程碑提交时，由 Aura 引擎自动进行物理测试验证并回写至内置实验账本中，你无需手动执行 `attach_ralph` 关联。

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

## 8.9 发布为 use-case 示例

本教程不应侵入 `aura create use-case` 这类系统级生成器。AutoKaggle 发布为 `use-cases/auto-kaggle` 下的示例、教程和可复制模板即可。

推荐目录形状：

```text
use-cases/auto-kaggle/
├── scripts/bootstrap.py
├── tools/
├── skills/
├── garden/
├── template/
└── tutorial/
```

教程正文负责带用户从零写出：

- `ak_competition`、`ak_submit_guard`。
- 训练、验证、候选选择和 polling 脚本。
- 完整 workflow 约束。
- offline fixture 和 smoke test。

`scripts/bootstrap.py` 可以作为可选辅助，用来把教程最终产物复制到一个目标 workspace，但不能成为系统级生成器的一部分，也不能替代教程里的从零实现路径。

使用方式：

```bash
python /path/to/aura/use-cases/auto-kaggle/scripts/bootstrap.py \
  --workspace ~/kaggle/playground-s5e1 \
  --slug playground-s5e1 \
  --mode offline
```

## 8.10 完成标准

一个可发布的 AutoKaggle 教程必须满足：

- 用户能从普通 Aura workspace 出发，按教程补齐 AutoKaggle agent。
- 完成后，日常使用只需要维护 `params/autokaggle.yml`。
- agent 能自动训练候选。
- Ralph verifier 能在提交前运行。
- submit guard 能阻止坏 submission。
- 达到提交上限时 agent 会调用 `timer` 等待。
- agent 能 poll Kaggle submission 结果。
- registry 能保存 CV、submission hash、verifier、LB feedback。
- dry-run 模式不需要 Kaggle token 也能完整跑通。
