# 1. 目标架构与运行方式

## 1.1 用户目标

AutoKaggle 的目标是让用户只写参数，剩下由 Aura agent 自动执行：

- 初始化 Kaggle 比赛工作区。
- 下载或读取比赛数据。
- 建立 baseline 和本地 CV。
- 自动生成候选实验。
- 运行训练并生成 submission。
- 使用 Ralph verifier 做提交前审计。
- 通过 submit guard 后真实提交。
- 自动读取 Kaggle 提交结果和 leaderboard 分数。
- 把结果写入 registry。
- 如果达到提交上限或冷却时间，调用 `timer` 等待，然后继续。
- 达到 stop condition 后停止。

## 1.2 为什么不能只靠一个大提示词

Kaggle 刷榜是长周期任务，单靠提示词会不稳定：

- 提交次数有限，不能让 agent 直接 shell submit。
- 大数据不能直接塞入上下文。
- public leaderboard 反馈需要结构化记录。
- 等待窗口可能很长，需要工具化。
- 提交前检查必须可重复。

因此系统分成两层：

```text
开放探索层：agent / subagent / workflow.yml / prompts / garden / skill
稳定工作流层：ak_* tools / registry / submit guard / Ralph verifier / timer
```

agent 可以自由提出实验，但提交、等待、记录和 leaderboard 读取必须通过确定性工具。

这里的命名边界要保持清楚：

- Garden 是 Aura 的上下文工程和脚手架 playbook。它负责说明这个 AutoKaggle workspace 应该长什么样、哪些提示词/锚点/工具/skill 应被组合起来、阶段门禁如何组织。
- Workflow 是 AutoKaggle 的可运行契约。`workflow.yml` 指向 params、Garden、Skill、prompts、tools 和 anchors，让 Aura 能执行 `doctor/status/run`。用户通常运行 `aura workflow run`，底层同一契约也可以由 `aura kernel workflow` 直接接收。
- Skill 是 AutoKaggle 内部的可复用操作规程。`skills/auto-kaggle/SKILL.md` 告诉 agent 在一次竞赛循环里具体如何行动。
- Tool 是确定性执行能力。下载、提交、等待、记录和校验都应落到 `ak_*` tools、`timer` 或 Ralph verifier，而不是只靠文字约束。

## 1.3 Aura 运行单元

`use-cases/auto-kaggle` 是教程和模板源，不是运行目录。真正运行的是用户创建的 Aura workspace：

```text
~/kaggle/my-competition/
├── .aura-workspace/
├── tools/
├── skills/
├── garden/
├── prompts/
├── params/
├── workflow.yml
├── src/
├── data/
├── experiments/
├── submissions/
├── reports/
└── task.md
```

Aura 会在 workspace 根目录发现：

- `tools/*/manifest.json`
- `skills/*/SKILL.md`
- `garden/garden.md`
- `garden/*/garden.md`
- `prompts/system/*.md`
- `prompts/ralph/*.md`
- `anchors/*.json`
- `workflow.yml`
- `.hint` 文件和 `@aura-hint`

## 1.4 核心组件

第一版自动刷榜系统由这些组件组成：

```text
params/autokaggle.yml
  用户唯一主要入口，写 slug、metric、提交预算、停止条件。

workflow.yml
  AutoKaggle 运行契约：声明 params、Garden、Skill、prompts、required tools、stages 和默认 run goal。

tools/ak_competition
  Kaggle CLI 封装：下载、提交、读取 submissions、读取 leaderboard。

tools/ak_submit_guard
  提交前门禁：格式、CV、预算、冷却、重复 hash、Ralph verifier 结果。

tools/ak_run_registry
  实验账本：记录每次训练、提交、LB 分数、结论。

tools/timer
  Aura 已有等待工具：达到提交上限后按 guard 返回的 wait_seconds 等待。

src/train_candidate.py
  训练一个候选并生成 submission。

src/select_next_experiment.py
  根据 registry 选择下一轮方向，给 agent 可读建议。

garden/auto-kaggle/garden.md
  AutoKaggle Garden playbook：组织工作区、提示词、锚点、skill、工具边界和阶段门禁。

skills/auto-kaggle/SKILL.md
  AutoKaggle 文档内部的 agent 操作规程。

prompts/system/SOUL.md
prompts/system/TOOLS.md
  让 agent 以 Kaggle 自动化执行者身份工作。

prompts/ralph/ralph_system.md
prompts/ralph/critic_rules.md
  提交前用 Ralph loop 做 verifier。
```

## 1.5 自动循环状态机

agent 执行的循环：

```text
read params
  ↓
catalog data
  ↓
ensure baseline and validation
  ↓
propose candidate
  ↓
train candidate
  ↓
record CV and artifacts
  ↓
run Ralph verifier
  ↓
submit guard
  ↓
if wait_required: call timer, then retry guard
  ↓
submit
  ↓
poll Kaggle submission result
  ↓
attach LB score
  ↓
decide next experiment or stop
```

关键点：等待不是失败。`ak_submit_guard` 返回 `status: "wait_required"` 时，agent 必须调用 `timer`，等待后继续同一个候选，不应该重新训练。

## 1.6 安全默认值

面向用户教程必须默认安全：

- `allow_submit: false` 时禁止真实提交。
- `mode: dry_run` 时只能跑本地验证。
- `submit_guard` 是唯一允许调用 Kaggle submit 的工具。
- 如果比赛规则需要人工接受，`ak_competition` 必须停止并提示用户。
- Kaggle token 不写入 repo，不打印到工具输出。

真实自动刷榜只在用户显式设置：

```yaml
submission:
  allow_submit: true
  auto_wait: true
  auto_poll_leaderboard: true
```

## 1.7 本教程完成后的用户命令

```bash
aura workflow doctor
aura workflow status
aura workflow run
```
