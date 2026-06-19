# 2. 创建比赛工作区与参数文件

## 2.1 创建 Aura workspace

不要在 Aura 源码根目录里跑比赛。为每个比赛创建一个独立 workspace：

```bash
mkdir -p ~/kaggle
aura new ~/kaggle/playground-s5e1
cd ~/kaggle/playground-s5e1
```

检查：

```bash
aura info
ls .aura-workspace
```

## 2.2 创建目录

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

## 2.3 安装 Aura 内置 timer 工具

AutoKaggle 使用 `timer` 处理提交上限和冷却等待。

```bash
aura tools add timer
```

验证：

```bash
aura tools list | rg timer
```

如果教程在源码环境中手动复制，也可以从模板复制：

```bash
cp -R /path/to/aura/src/generators/aura/app/templates/tools/timer tools/timer
```

## 2.4 创建用户参数文件

创建 `params/autokaggle.yml`：

```yaml
competition:
  slug: "playground-series-s5e1"
  title: "Playground Series S5E1"
  mode: "kaggle"       # offline | kaggle
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

## 2.5 参数语义

用户主要改这些字段：

- `competition.slug`：Kaggle 比赛 slug。
- `competition.rules_accepted`：用户确认已接受比赛规则后改成 `true`。
- `data.target_column`：如果自动推断失败，在这里写目标列。
- `metric.name`：例如 `auc`、`rmse`、`logloss`。
- `metric.higher_is_better`：分数越大越好还是越小越好。
- `submission.allow_submit`：真实提交开关。
- `submission.daily_budget`：每天最多自动提交次数。
- `loop.max_rounds`：agent 最大实验轮数。

## 2.6 创建 task.md

创建 `task.md`，让 Aura 长任务上下文始终看到当前目标：

```markdown
# AutoKaggle Task

- [ ] Read params/autokaggle.yml
- [ ] Confirm Kaggle competition files are available
- [ ] Catalog train/test/sample submission
- [ ] Build or verify local validation
- [ ] Train baseline candidate
- [ ] Record baseline in ak_run_registry
- [ ] Generate next candidate
- [ ] Run Ralph verifier before real submit
- [ ] Pass ak_submit_guard
- [ ] Submit or wait according to guard result
- [ ] Poll leaderboard result
- [ ] Attach leaderboard score to registry
- [ ] Continue until stop condition
```

## 2.7 创建 anchors

创建 `anchors/00_ready.json`：

```json
{
  "id": "00_ready",
  "call_when": [
    "AutoKaggle workspace has params, tools, skill, garden, prompts, and task.md."
  ],
  "next": [
    "10_validation_frozen"
  ]
}
```

创建 `anchors/10_validation_frozen.json`：

```json
{
  "id": "10_validation_frozen",
  "call_when": [
    "Local validation has a recorded baseline and fold/metric assumptions are written to reports/validation.md."
  ],
  "next": [
    "20_submission_loop_started",
    "30_feedback_recorded"
  ]
}
```

创建 `anchors/20_submission_loop_started.json`：

```json
{
  "id": "20_submission_loop_started",
  "call_when": [
    "The autonomous submit/wait/poll loop has completed at least one guarded dry-run or real submission."
  ],
  "next": [
    "20_submission_loop_started",
    "30_feedback_recorded"
  ]
}
```

创建 `anchors/30_feedback_recorded.json`：

```json
{
  "id": "30_feedback_recorded",
  "call_when": [
    "A Kaggle submission result or dry-run result has been attached to the experiment registry."
  ],
  "next": [
    "20_submission_loop_started"
  ]
}
```

这里的 `next` 表示推荐的后继 anchor 集合，不是 runtime 的硬跳转规则。agent 仍然可以自己选择当前在哪个 anchor 上；`anchor_submit` 里的 `selected_next` 只是把本轮推荐焦点持久化下来，方便后续上下文继续围绕该 anchor 展开。

## 2.8 创建 workflow.yml

`workflow.yml` 是 AutoKaggle 的运行契约。它不替代 Garden、Skill、tools 或 params；它把这些文件装配成 Aura 可以 `doctor/status/run` 的 workflow。

这里要把 `garden` 和 `anchor` 分开理解：

- `garden` 负责描述项目级上下文装配方式，例如要读哪些文件、有哪些工具和 skill、工作区应该如何组织。
- `anchor` 负责描述任务节点和推荐的后继节点，供 agent 做软状态推进和进度打点。

创建 `workflow.yml`：

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
    - ak_run_registry
    - ak_submit_guard
    - timer

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
    Use ak_run_registry as the source of truth for experiment facts.
    Use ak_submit_guard for every submission decision.
    Use timer whenever submit guard or leaderboard polling requires waiting.
    Before every real submission, run Ralph verifier with the command configured in params.
    If Ralph returns status completed, attach its result_path with ak_run_registry attach_ralph.
    If ak_submit_guard returns wait_required, call timer with wait_chunk_seconds, then retry the same candidate and guard action.
    Never call raw Kaggle submit through shell.
    Continue until a configured stop condition is met.
```

第一版 Aura workflow CLI 会消费 `params`、`context`、`tools.required`、`stages` 和 `run`。在 AutoKaggle 里，submission guard、Ralph verifier、registry 和 wait/retry 这些硬约束继续由 tools 和外部执行逻辑负责；`workflow.yml` 先只承担运行契约、阶段可见性和后续状态推进入口。

## 2.9 验证 workspace

```bash
aura tools list
aura garden status
aura anchor status
aura workflow doctor
aura workflow status
aura kernel observe
```
此时 `timer` 应可见，`aura garden status` 应显示 workspace 总览和 anchor 聚合进度，`aura anchor status` 应显示具体 anchor 节点及推荐后继节点，`workflow.yml` 中声明的 params、Garden、Skill、prompts、tools 和 anchors 应能通过 `aura workflow doctor`。
