---
name: auto-kaggle
description: Garden playbook for assembling an AutoKaggle competition workspace.
requires:
  - ak_competition
  - ak_submit_guard
  - timer
  - anchor_submit
---

# AutoKaggle Garden

## Mission

Run the Kaggle competition according to `params/autokaggle.yml`. Keep competition
differences in params. Keep irreversible operations behind tools.

## Required Loop

1. Read `params/autokaggle.yml`.
2. Ensure data exists. If missing and mode is `kaggle`, call `ak_competition download`.
3. Call `ak_competition catalog`.
4. Train or improve one candidate.
5. Record candidate with `aura.registry.record` or the local registry helper.
6. Call `ak_submit_guard validate`.
7. If guard returns `wait_required`, call `timer`, then retry the same candidate.
8. If guard passes and `allow_submit=true`, call `ak_submit_guard submit`.
9. Poll result using `ak_competition submissions`.
10. Record leaderboard feedback using `aura.registry.record`.
11. Stop only when a stop condition in params is met.

## Hard Rules

- Never call raw Kaggle submit directly through shell.
- Real submission is only allowed through `ak_submit_guard submit`.
- If waiting is required, keep the same run id and submission path.
- Use anchors as progress snapshots, not as a hard state machine.
