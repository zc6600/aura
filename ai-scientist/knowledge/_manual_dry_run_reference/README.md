# Not Aura Output

These files (and the sibling `topics/_manual_dry_run_reference/`) were produced by hand, by the assisting Claude Code session directly, before the `research-topic-selector` skill was actually wired into this workspace and run through `aura agent`. They are kept as a before/after comparison point, not as a valid Stage 0 result — the workspace wasn't even a real Aura project (no `.aura-workspace/`) when these were written.

Also worth keeping: the gate-6 novelty check run manually against `cand_001` and `cand_002` genuinely found a likely conflict on `cand_001` (the source paper's own SW-Whittle method already does adaptive window-tuning via Bandit-over-Bandit) before this was superseded by a real run. Whether the real Aura run reaches the same conclusion is itself a useful check on the skill design.
