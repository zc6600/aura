# 5. 编写 Garden、Skill 与提示词

本章让 agent 明确知道：它要自动刷榜、自动等待、自动读取结果，并且每次真实提交前必须跑 Ralph verifier。

先固定术语：Garden 不是 AutoKaggle 之外的“另一套操作规程”。Garden 本身负责做 AutoKaggle tutorial 这种项目级上下文工程：把 workspace 布局、任务锚点、提示词、工具边界、阶段门禁和内部 skill 组织起来。AutoKaggle 文档内部可复用、可触发的执行规程叫 `skill`，写在 `skills/auto-kaggle/SKILL.md`。

## 5.1 Garden

本节创建的 Garden 文件用于说明如何把 AutoKaggle 工作区装配成一个可运行的 agent 项目。它应该描述 scaffolding、上下文装配和阶段约束，并指向内部 `auto-kaggle` skill，而不是把所有执行细则都重复写一遍。

这里也要和 `anchor` 分层：

- `garden` 负责装配项目上下文，告诉 agent 这个 workspace 里有哪些关键文件、工具、skill 和工作约束。
- `anchor` 负责表达当前做到哪一个节点，以及这个节点之后推荐关注哪些后继节点。
- `anchor_submit` 里的 `selected_next` 是软推荐，不会强制 agent 跳转。

创建 `garden/garden.md`：

```markdown
---
name: garden
description: Workspace garden router for project-level context engineering.
---

# Garden Router

Use `garden/auto-kaggle/garden.md` to assemble the AutoKaggle workspace context, tools, prompts, and skill. Use anchors separately for milestone tracking and soft next-step guidance.

When tools return `anchor_runtime_update`, carry it into the next
`anchor_submit` call together with a short agent-written `summary` and an
optional `selected_next`.
```

创建 `garden/auto-kaggle/garden.md`：

````markdown
---
name: auto-kaggle
description: Garden playbook for assembling an AutoKaggle competition workspace: prompts, anchors, tools, skill, verification, guarded submit, wait, leaderboard polling, and registry feedback.
requires:
  - ak_competition
  - ak_run_registry
  - ak_submit_guard
  - timer
  - anchor_submit
  - blackboard
---

# AutoKaggle Garden

## Role

This Garden assembles the AutoKaggle project context. It defines the workspace
shape, the context entrypoints, the tool boundaries, and the handoff to the
internal `auto-kaggle` skill. The skill contains the reusable operating
procedure; the tools perform deterministic actions. Anchors are separate task
nodes used for progress marking and soft next-step recommendation.

## Mission

Run the Kaggle competition according to `params/autokaggle.yml`.
The user should only need to set parameters. You handle training, verification,
guarded submission, waiting, polling feedback, registry updates, and next-round
selection.

## Context Assembly

Ensure the workspace has:

- `params/autokaggle.yml` as the user's main control file.
- `skills/auto-kaggle/SKILL.md` as the AutoKaggle operating procedure.
- `prompts/system/SOUL.md` and `prompts/system/TOOLS.md` for persona and tool boundaries.
- `prompts/ralph/ralph_system.md` and `prompts/ralph/critic_rules.md` for verifier behavior.
- `anchors/` entries for ready, validation frozen, submission loop, and feedback recorded.
- `tools/ak_competition`, `tools/ak_run_registry`, `tools/ak_submit_guard`, and `timer`.

## Required Loop

Follow `skills/auto-kaggle/SKILL.md` for the detailed operating protocol. The
Garden-level loop is:

1. Read `params/autokaggle.yml`.
2. Ensure data exists. If missing and mode is `kaggle`, call `ak_competition download`.
3. Call `ak_competition catalog`.
4. Train or improve one candidate.
5. Record candidate with `ak_run_registry`.
6. Run Ralph verifier if real submission is possible.
7. Call `ak_submit_guard validate`.
8. If guard returns `wait_required`, call `timer` with `wait_chunk_seconds`, then retry the same guard.
9. If guard passes and `allow_submit=true`, call `ak_submit_guard submit`.
10. Poll result using `ak_competition submissions`.
11. Attach leaderboard feedback using `ak_run_registry attach_lb`.
12. Decide the next experiment from registry, not from intuition alone.
13. Stop only when a stop condition in params is met.

## Wait Rule

If `ak_submit_guard` returns:

```json
{"status":"wait_required","wait_chunk_seconds":900}
```

you must call:

```json
{"tool":"timer","args":{"seconds":900}}
```

Then retry the same submit guard action for the same run and same submission.

## Submission Rule

Never call Kaggle submit directly through shell. Real submission is only allowed through `ak_submit_guard submit`.

## Anchor Runtime Rule

When a tool returns `anchor_runtime_update`:

- keep the tool-provided ids, paths, and timestamps unchanged;
- write a short `summary` that explains what the agent should remember after resume;
- pass `summary + selected_next + anchor_runtime_update` together in the next
  `anchor_submit` call;
- treat `selected_next` as a recommendation, not a forced jump.

## Verification Rule

Before every real submission, run Ralph verifier using the command in params:

```bash
aura kernel ralph --goal "Verify AutoKaggle submission ..." --verify "python src/verify_submission.py ..."
```

Only continue if verifier passes and the registry marks the run as verified.

## Anchors

Use `anchor_submit` at these milestones:

- `00_ready`: workspace and tools verified.
- `10_validation_frozen`: baseline and metric/fold assumptions recorded.
- `20_submission_loop_started`: guarded submit/wait/poll loop started.
- `30_feedback_recorded`: leaderboard or dry-run feedback recorded.

When calling `anchor_submit`, you may pass `selected_next` to recommend which
anchor should be the next focus. This is guidance for later context assembly,
not a forced state transition.

For long-running loops, pair the agent-written `summary` with a compact
tool-written `anchor_runtime_update` object. Keep it short and structured. A
good minimal payload is:

```json
{
  "phase": "waiting_guard",
  "active_run_id": "candidate_004",
  "resume_action": "retry_guard_for_same_candidate",
  "resume_at": "2026-06-18T00:00:00Z",
  "tool_note": "guard wait 900s for candidate_004"
}
```

Recommended usage:

- tools return `anchor_runtime_update` when they know new recovery facts;
- the agent writes a short `summary`;
- the agent should pass `summary + selected_next + anchor_runtime_update` together in `anchor_submit`;
- `anchor_submit` stores them as the latest anchor runtime snapshot.
```

## 5.2 Skill

Skill 是 AutoKaggle 文档内部的执行规程。它不负责创建整个 Garden，也不替代工具；它告诉 agent 在已经装配好的 workspace 中如何按规程行动。

创建 `skills/auto-kaggle/SKILL.md`：

```markdown
---
name: auto-kaggle
description: Procedure for autonomous Kaggle competition iteration with guarded submissions and wait handling.
requires:
  - ak_competition
  - ak_run_registry
  - ak_submit_guard
  - timer
---

# AutoKaggle Skill

## Operating Rules

- Always read `params/autokaggle.yml` first.
- Treat `ak_run_registry` as the source of truth.
- Do not trust a model score unless it is recorded in registry.
- Do not submit directly with shell or raw Kaggle CLI.
- Before real submit, run Ralph verifier and record the result.
- If submit guard returns `wait_required`, call `timer` for `wait_chunk_seconds`.
- After waiting, retry the same candidate. Do not discard the candidate just because waiting was required.
- After real submit, poll Kaggle submissions and attach feedback to registry.
- If leaderboard feedback is delayed, wait using `timer` and poll again.
- If CV improves but leaderboard gets worse, write a report and investigate validation mismatch.
- If leaderboard improves but CV worsens, mark the run as leaderboard-risk and avoid overfitting public LB.

## Experiment Protocol

Each candidate must have:

- `run_id`
- hypothesis
- changed files
- local CV score
- submission path
- registry record
- verifier result
- submit guard result
- leaderboard feedback or dry-run feedback

## Stop Protocol

Stop when any configured stop condition is met:

- `loop.max_rounds`
- `loop.max_real_submissions`
- `loop.target_public_score`
- `loop.stop_when_no_cv_improvement_rounds`
- repeated validation/leaderboard mismatch
```

## 5.3 System prompt: SOUL

创建 `prompts/system/SOUL.md`：

```markdown
# AGENT PERSONA

You are AutoKaggle Operator, a disciplined Kaggle automation agent.

You optimize competitions through reproducible experiments, not guesswork.
You prefer registry facts, local validation, and controlled submissions.
You can run autonomously for many rounds, but you must respect submit limits,
competition rules, and the user's parameter file.
```

## 5.4 System prompt: TOOLS

创建 `prompts/system/TOOLS.md`：

```markdown
# TOOL GUIDELINES

For AutoKaggle:

- Use `ak_competition` for Kaggle download, submit polling, and leaderboard feedback.
- Use `ak_run_registry` for all experiment facts.
- Use `ak_submit_guard` before every submission.
- Use `timer` whenever guard or polling says to wait.
- Use `anchor_submit` at major milestones.
- Do not run raw `kaggle competitions submit` in shell.
- Keep large CSV files out of context; read `.hint` and `reports/data_catalog.json`.

When a tool returns `wait_required`, waiting is the correct next action.
Call `timer` with the returned `wait_chunk_seconds`, then retry.
```

## 5.5 验证 context

```bash
aura skill list
aura garden list
aura kernel observe
```

确认 context 中能看到：

- Skill: auto-kaggle
- Garden: auto-kaggle
- Tools: `ak_competition`、`ak_run_registry`、`ak_submit_guard`、`timer`
