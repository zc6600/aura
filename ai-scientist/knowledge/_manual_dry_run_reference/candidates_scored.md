# Stage 3: Admissibility Scoring

Rule: all five gates must pass. No partial credit — a 4/5 candidate is a rejected candidate.

| ID | Gate 1: Openness | Gate 2: Verifiability | Gate 3: Compute | Gate 4: Reachability | Gate 5: Recency | Verdict |
|----|-------------------|------------------------|-------------------|------------------------|-------------------|---------|
| cand_001 | PASS — verbatim quote, full text confirmed via arxiv.org/html fetch | PASS — dynamic regret is a numeric, simulation-computed quantity | PASS — small finite-state restless bandit MDPs, numpy, sub-second per episode | PASS — testing a variation-adaptive index estimator against the paper's baseline in the flagged high-V_n regime is a concrete next experiment, doesn't require the paper's other two future-work threads (lower bounds, continuous state) to be solved first | PASS — 2025 | **ADMITTED** |
| cand_002 | PASS — verbatim quote, full text confirmed | PASS — cumulative regret comparison, paired significance test, no subjective judgment | PASS — low-dimensional linear bandit simulation, numpy, seconds per run | PASS (scoped) — full closed-loop-optimal policy design is flagged by the authors as theoretically hard, but testing *a* heuristic adaptive policy empirically against the open-loop baseline doesn't require solving that theory first | PASS — 2025 | **ADMITTED** |
| cand_003 | PASS — verbatim quote (limitations + future-work sections), full text confirmed | PASS — regret growth curve comparison is a numeric, non-subjective check | CONDITIONAL — plausible for a scaled-down synthetic setting, but not confidently estimable yet | **FAIL** — a faithful reimplementation of C3 (transductive learning + importance-weighted estimator, "dependent on heuristics and whether the learned embedding space is well-calibrated") cannot be specified as a concrete next experiment from the limitations/future-work excerpts alone. The immediate next step is a full paper read, not an experiment. Per the "don't round up" rule this fails gate 4 today, even though it may be promotable after that read. | PASS — 2026 | **REJECTED (revisit after full-paper read)** |
| cand_004 | **FAIL** — no verbatim quote obtained (abstract-page fetch found no explicit limitation) | n/a | n/a | n/a | n/a | **REJECTED** |
| cand_005 | **FAIL** — same as above | n/a | n/a | n/a | n/a | **REJECTED** |
| cand_006 | FAIL (recency, gate 5) — 2023 source, outside window, not re-confirmed as still open by newer work | n/a | n/a | n/a | **FAIL** | **REJECTED** |
| cand_007 | **FAIL** — OpenReview page blocked by login wall, quote could not be verified | n/a | n/a | n/a | n/a | **REJECTED** |
| cand_008 | **FAIL** — no verbatim quote obtained | n/a | n/a | n/a | n/a | **REJECTED** |

## Outcome
2 of 8 candidates ADMITTED (cand_001, cand_002). This is the expected shape of a working gate — most literature leads don't survive contact with "can you actually quote and verify it," and that's the point.
