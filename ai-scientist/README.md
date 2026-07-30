# Aura AI-Scientist (Flagship Line)

This is the main-line, continuously-evolving project this whole repository exists to serve. Everything else — the kernel, the garden playbooks, the skills, the other `use-cases/` — is infrastructure built to eventually make this workspace capable of autonomous, open-ended science. This directory is not a demo; it does not "graduate" to `use-cases/` as a whole. Individual proven slices of it may get extracted there later, but the line itself stays here.

## Current Constraints (decided, not TODO)

- **No self-reference yet.** The framework isn't mature enough to safely research itself. Research targets must be external domains.
- **Genuinely open problems only.** No closed-form parameter search (ruled out: `garden/perf-tuning`-style curve fitting, `garden/kaggle`-style leaderboard climbing) — the point is hypothesis generation, not optimization in a known space.
- **CPU-only, seconds-to-minutes per experiment.** No GPU training, no paid API calls inside the evaluated loop. This is a hard budget, not a preference — see `skills/research-topic-selector` gate 3.
- **Programmatic verification only.** No step in a core claim may rely on an LLM's subjective judgment of "is this good." See gate 2.

## Pipeline

```
Stage 0: Topic Selection   -> skills/research-topic-selector
Stage 1-2: Literature + Prototype -> garden/ai-scientist (Phase 1-2)
Stage 3: Sweeps + Verification    -> garden/ai-scientist (Phase 3), gated by Ralph (aura kernel ralph)
Stage 4-5: Plotting + Report      -> garden/ai-scientist (Phase 4-5)
```

Stage 0 output (an `ADMITTED` topic brief from `topics/<id>/brief.md`) becomes the Stage 1 input (`knowledge/` + `task.md`) for the rest of the pipeline.

## Structure

```text
ai-scientist/
├── README.md              <- this file
├── task.md                <- current stage / running log
├── prompts/system/        <- SOUL.md (persona), USER.md (standing preferences)
├── knowledge/              <- Stage 0 literature sweep artifacts (candidates_raw.md, candidates_structured.json, candidates_scored.md)
├── topics/                 <- Stage 0 output: one dir per ADMITTED candidate, brief.md inside
└── src/                    <- experiment code, once a topic is confirmed and Stage 1-2 begins
```

`state/` is gitignored at the repo root and will hold session DBs, Ralph run artifacts, etc. once experiments start.

## Log

- 2026-07-30: Workspace created. Stage 0 running for the first time against the bandit / online-learning subfield (chosen for near-zero compute + rich recent literature with explicit open-problem statements).
