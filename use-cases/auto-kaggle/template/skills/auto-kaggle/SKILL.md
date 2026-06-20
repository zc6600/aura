---
name: auto-kaggle
description: Procedure for autonomous Kaggle iteration with guarded submissions.
requires:
  - ak_competition
  - ak_submit_guard
  - timer
---

# AutoKaggle Skill

## Operating Rules

- Always read `params/autokaggle.yml` first.
- Treat the experiment registry as the source of truth.
- Do not submit directly with shell or raw Kaggle CLI.
- Before real submit, make sure verifier evidence is recorded.
- If submit guard returns `wait_required`, call `timer` for `wait_chunk_seconds`.
- After waiting, retry the same candidate.
- After real submit, poll Kaggle submissions and record feedback.

## Candidate Requirements

Each candidate must have:

- `run_id`
- hypothesis
- local CV score
- submission path
- registry record
- verifier result before real submit
- submit guard result
- leaderboard feedback or dry-run feedback
