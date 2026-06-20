# 2. 创建比赛工作区与参数文件

本章从一个普通 Aura workspace 开始。AutoKaggle 是 use-case 层实现，不依赖 `aura create use-case auto-kaggle`，也不要求修改 Aura 核心。用户会在 workspace 中从零创建 AutoKaggle 的目录、参数文件、workflow、tools、Garden 和 Skill。

## 2.1 创建 Aura workspace

不要在 Aura 源码根目录里跑比赛。为每个比赛创建独立 workspace：

```bash
aura new ~/kaggle/playground-s5e1
cd ~/kaggle/playground-s5e1
```

检查：

```bash
aura info
```

## 2.2 创建 AutoKaggle 目录

一次性创建 AutoKaggle 需要的目录：

```bash
mkdir -p \
  params \
  tools \
  skills \
  garden/auto-kaggle \
  prompts/system \
  prompts/ralph \
  anchors \
  src \
  data/raw \
  data/processed \
  experiments/artifacts \
  submissions \
  reports \
  knowledge
```

最终本教程会填充这些文件：

```text
params/autokaggle.yml
workflow.yml
garden/auto-kaggle/garden.md
skills/auto-kaggle/SKILL.md
prompts/system/SOUL.md
prompts/system/TOOLS.md
prompts/ralph/ralph_system.md
prompts/ralph/critic_rules.md
anchors/*.json
tools/timer/
src/
data/
experiments/
submissions/
reports/
knowledge/
task.md
```

这里没有调用系统级生成器。这样 AutoKaggle tutorial 不侵入 Aura 的基础能力，也不会让用户误以为 AutoKaggle 是 Aura 内置功能。

## 2.3 先固定用户参数文件

打开 `params/autokaggle.yml`。从这一章开始，比赛差异应尽量集中在这里，后续代码读取这个文件，而不是把 slug、metric、预算和提交策略散落在脚本里。

用户通常只改这些字段：

- `competition.slug`：Kaggle 比赛 slug。
- `competition.mode`：先用 `offline`，确认闭环后再改 `kaggle`。
- `competition.rules_accepted`：用户确认已接受比赛规则后改成 `true`。
- `data.target_column`：如果自动推断失败，在这里写目标列。
- `metric.name` 和 `metric.higher_is_better`：本地验证指标。
- `submission.allow_submit`：真实提交开关，默认必须是 `false`。
- `submission.daily_budget`：每天最多自动提交次数。
- `loop.max_rounds`：agent 最大实验轮数。

推荐默认配置形状：

```yaml
competition:
  slug: "playground-series-s5e1"
  title: "Playground Series S5E1"
  mode: "offline"      # offline | kaggle
  rules_accepted: false
  external_data_allowed: false

data:
  raw_dir: "data/raw"
  train_file: "data/raw/train.csv"
  test_file: "data/raw/test.csv"
  sample_submission_file: "data/raw/sample_submission.csv"
  id_column: "id"
  target_column: ""

metric:
  name: ""
  higher_is_better: true
  local_validation_required: true

validation:
  fold_file: "data/processed/folds.csv"
  frozen: false
  n_splits: 5
  random_seed: 42
  min_cv_delta_to_submit: 0.0001

submission:
  allow_submit: false
  auto_wait: true
  auto_poll_leaderboard: true
  daily_budget: 3
  cooldown_minutes: 30
  max_wait_chunk_seconds: 900
  message_prefix: "autokaggle"
  require_ralph_verifier: true
  verifier_command: "python src/verify_submission.py --submission {submission_path} --run-id {run_id}"

loop:
  max_rounds: 50
  max_real_submissions: 20
  stop_when_no_cv_improvement_rounds: 8
  target_public_score: null
  sleep_after_failed_poll_seconds: 120

paths:
  registry_db: "experiments/runs.sqlite"
  submissions_dir: "submissions"
  reports_dir: "reports"
  artifacts_dir: "experiments/artifacts"
```

## 2.4 安装 Aura 内置 timer 工具

AutoKaggle 使用 `timer` 处理提交上限和冷却等待。`timer` 是通用系统工具，不是 AutoKaggle 专属能力。

```bash
aura tools add timer
```

验证：

```bash
aura tools list | rg timer
```

如果当前环境没有 `aura tools add timer`，也可以先跳过；第 7 章只要求最终 `timer` 可见。

## 2.5 创建 task.md

创建 `task.md`，让 Aura 长任务上下文始终看到当前目标：

```markdown
# AutoKaggle Task

- [ ] Read params/autokaggle.yml
- [ ] Confirm Kaggle competition files are available
- [ ] Catalog train/test/sample submission
- [ ] Build or verify local validation
- [ ] Train baseline candidate
- [ ] Record baseline in experiment registry
- [ ] Generate next candidate
- [ ] Run Ralph verifier before real submit
- [ ] Pass ak_submit_guard
- [ ] Submit or wait according to guard result
- [ ] Poll leaderboard result
- [ ] Attach leaderboard score to registry
- [ ] Continue until stop condition
```

## 2.6 创建 workflow.yml

`workflow.yml` 是 AutoKaggle 的运行契约。它不替代 Garden、Skill、tools 或 params；它把这些文件装配成 Aura 可以 `doctor/status/run` 的 workflow。创建 `workflow.yml`：

```yaml
version: 1
name: auto-kaggle
description: Autonomous Kaggle competition workflow with registry, verifier, guarded submission, wait, and leaderboard feedback.

params:
  path: params/autokaggle.yml

context:
  garden: garden/auto-kaggle/garden.md
  skill: skills/auto-kaggle/SKILL.md
  prompts:
    - prompts/system/SOUL.md
    - prompts/system/TOOLS.md
    - prompts/ralph/ralph_system.md
    - prompts/ralph/critic_rules.md

tools:
  required:
    - ak_competition
    - ak_submit_guard
    - timer

registry:
  db_path: ".aura-workspace/state/experiments.db"
  metrics:
    - name: cv_score
      higher_is_better: true

stages:
  - id: ready
    title: Workspace ready
    anchor: anchors/00_ready.json
  - id: validation_frozen
    title: Validation frozen
    anchor: anchors/10_validation_frozen.json
  - id: submission_loop_started
    title: Submission loop started
    anchor: anchors/20_submission_loop_started.json
  - id: feedback_recorded
    title: Feedback recorded
    anchor: anchors/30_feedback_recorded.json

run:
  mode: classic
  max_steps: 80
  goal: |
    Run AutoKaggle autonomously.
    Read params/autokaggle.yml before acting.
    Use the AutoKaggle Garden for project context.
    Follow the AutoKaggle Skill operating procedure.
    Use the experiment registry (aura.registry.record, aura.registry.best) as the source of truth for experiment facts.
    Use ak_submit_guard for every submission decision.
    Use timer whenever submit guard or leaderboard polling requires waiting.
    Before every real submission, run Ralph verifier with the command configured in params.
    Never call raw Kaggle submit through shell.
    Continue until a configured stop condition is met.
```

第一版 Aura workflow CLI 会消费 `params`、`context`、`tools.required`、`stages` 和 `run`。在 AutoKaggle 里，submission guard、Ralph verifier、registry 和 wait/retry 这些硬约束继续由内置引擎、tools 和外部执行逻辑负责；`workflow.yml` 先只承担运行契约、阶段可见性和后续状态推进入口。

## 2.7 验证 workspace

```bash
aura tools list
aura garden status
aura anchor status
aura workflow doctor
aura workflow status
```

在 03-06 章还没完成前，`workflow doctor` 可能会提示 `ak_competition`、`ak_submit_guard`、Garden、Skill 或 prompt 文件缺失。这是正常的；后续章节会逐步补齐。第 8 章的 smoke test 才要求完整通过。

## 2.8 本教程的简化原则

后续章节仍然会让用户从头写关键组件，但遵守这些原则：

- 不改 Aura 核心代码。
- 所有比赛差异写进 `params/autokaggle.yml`。
- 训练脚本通过参数和约定路径运行，agent 主要创建候选实验而不是改全局框架。
- 真实提交只能通过 `ak_submit_guard`，不能靠提示词约束 agent 不犯错。
- 等待、提交预算、重复 hash、verifier 结果都由工具检查，不散落在 prompt 里。

这样用户仍然从头搭建自己的 agent，但需要改的代码集中、边界清楚。
