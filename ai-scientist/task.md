# Task Progress Checklist

- [x] Stand up ai-scientist/ workspace, wire in research-topic-selector skill + real search tool
- [ ] Stage 0: run `research-topic-selector` against the bandit/online-learning subfield (real Aura run, not manual)
  - [ ] Stage 1: literature sweep -> knowledge/candidates_raw.md
  - [ ] Stage 2: structure candidates -> knowledge/candidates_structured.json
  - [ ] Stage 3: score against 5 admissibility gates -> knowledge/candidates_scored.md
  - [ ] Stage 3.5: novelty confirmation on gate-1-5 survivors
  - [ ] Stage 4: compile briefs for ADMITTED candidates -> topics/<id>/brief.md
  - [ ] Stage 5: present ranked recommendation, get confirmation
- [ ] Stage 1-2 (garden/ai-scientist): prototype the confirmed hypothesis
- [ ] Stage 3 (garden/ai-scientist + Ralph): sweep + verify
- [ ] Stage 4-5 (garden/ai-scientist): plot + report

Note: `knowledge/_manual_dry_run_reference/` and `topics/_manual_dry_run_reference/` hold a manually-produced (non-Aura) dry run kept only as a comparison baseline — not a valid Stage 0 result.

(This file is also owned/rewritten by the `plan_task` tool during a real agent run — a test call during setup reset it once; restored by hand here before the real run.)
