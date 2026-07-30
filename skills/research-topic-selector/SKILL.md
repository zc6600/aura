---
name: research-topic-selector
description: Mines recent literature for a genuinely open research problem within a target subfield and vets it against strict admissibility gates (open, programmatically verifiable, low-compute, reachable, recent). Use when the user asks to "find a research topic", "pick an open problem", "选题", "找一个前沿但低成本的研究方向", or before starting any ai-scientist experiment cycle that needs a Phase-1 hypothesis seed.
---

# Research Topic Selector

## Requirements
- subagent
- search_open
- search_query
- search_close
- read_file
- write_file
- plan_task

This is a **Stage 0 skill** for the `ai-scientist` line of work. Its only job is to decide *what to research* — it does not run experiments itself. A candidate topic that passes here becomes the seed `task.md` / Phase-1 input for `garden/ai-scientist/garden.md`.

The core problem this skill solves: an LLM asked to "find a good research idea" will default to either (a) reinventing a well-trodden area where nothing new is left to find, or (b) proposing something un-checkable that only an LLM's own subjective judgment can adjudicate. Both are dead ends for an autonomous system. This skill forces every candidate through objective admissibility gates *before* any experiment code is written, so compute and effort are never spent on a topic that was doomed at selection time.

---

## Admissibility Gates

A candidate topic must pass **all six** gates below. Any single failure disqualifies it — this is a hard filter, not a weighted score. Do not round up on partial credit; a topic that is 5/6 is a rejected topic.

Gates 1-5 are checked in Stage 3, from what the Stage 1 sweep already turned up. Gate 6 is checked separately in Stage 3.5, using a fresh targeted search — it cannot be answered from Stage 1 data, because Stage 1 was searching for *open* problems, not for *whether this one has since closed*.

| # | Gate | Pass condition | Typical failure |
|---|------|-----------------|------------------|
| 1 | **Openness evidence** | The gap traces to a concrete source: a "Limitations" / "Future Work" statement in a paper from the last ~2 years, or a documented absence of follow-up work addressing it. | Agent's own hunch that "nobody has tried this," with no citation. |
| 2 | **Programmatic verifiability** | Success/failure can be checked by running code and comparing numbers (regret, accuracy, a proof/counterexample, a statistical test) — no step in the core claim requires an LLM to subjectively judge whether the result is "good." | The only evaluation is "does this look better," judged by an LLM. |
| 3 | **Compute budget** | A single experiment runs to completion in seconds-to-low-minutes on CPU only. No GPU, no paid training runs, no external API calls inside the evaluated loop. | Requires training a neural net, or hundreds of paid LLM calls per experiment. |
| 4 | **Reachability** | There is a concrete next experiment reachable from current methods — the gap is an increment, not itself gated behind a separate unsolved problem. | The gap can only be attacked after some other open question is resolved first. |
| 5 | **Recency** | Source material is from roughly the last ~2 years. Recency is a cheap proxy for "probably still open" — it doesn't replace gate 1, it supports it. | Citing a 2005 paper's limitations section and assuming it's unaddressed. |
| 6 | **Novelty confirmation** | A targeted search — for citations of the source paper, later versions of the same paper, and the proposed mechanism's keywords combined with the paper's specific setting — turns up no work that already implements or tests the exact proposed approach. | A newer paper, a v2 of the source paper, or work missed in Stage 1 already did this. Being unaware of prior art is not evidence it doesn't exist. |

---

## Core Process

### Stage 1: Literature Sweep
- **Persona**: `literature_scout`
- **Goal**: Search the target subfield (given by the user, or previously agreed in conversation) for recent papers/preprints. For each candidate paper, extract the verbatim "Limitations" / "Future Work" text — do not paraphrase yet, quote it.
- **Output**: Append each finding to `knowledge/candidates_raw.md` as a dated entry: `{title, venue/year, url_or_id, verbatim_limitation_quote}`. Reuse the `ai-scientist` garden convention — keep raw paper text out of context; only the extracted quote goes into the working file.
- Stop once you have 8-15 raw candidates. More than that just adds noise to the next stage.

### Stage 2: Candidate Structuring
- **Persona**: `methodologist`
- **Goal**: Convert each raw quote into a structured candidate object. Do not invent details not supported by the source quote.
```json
{
  "id": "cand_001",
  "source": "Author et al., Venue Year, <url_or_id>",
  "quote": "verbatim limitation/future-work text",
  "claimed_gap": "one sentence: what specifically is unresolved",
  "proposed_verifier": "the exact programmatic check that would decide pass/fail",
  "estimated_compute": "e.g. 'pure numpy, <1s per run, CPU only'",
  "is_recent": true
}
```
- Write all candidates to `knowledge/candidates_structured.json`.

### Stage 3: Admissibility Scoring
- **Persona**: `critic`
- **Goal**: Run every candidate through the five gates above. Record a boolean per gate plus a one-line reason. Any `false` disqualifies the candidate — do not compute an aggregate score.
- **Output**: `knowledge/candidates_scored.md`, a table of all candidates with per-gate pass/fail and final verdict (`ADMITTED` / `REJECTED`).
- Candidates failing gate 1 or 2 should be rejected outright rather than "fixed" — a topic without real openness evidence or a real verifier is not salvageable by rewriting its description.
- Candidates failing gates 1-5 do not proceed to Stage 3.5 — there is no point spending search budget confirming novelty for something that was never admissible on its own terms.

### Stage 3.5: Novelty Confirmation
- **Persona**: `literature_scout`
- **Goal**: For each candidate that passed gates 1-5, run a dedicated search distinct from Stage 1's — look for citations of the source paper, a later version/revision of the same paper, and searches combining the proposed mechanism's name/keywords with the paper's specific setting. The question is narrow: "has anyone already done the specific thing `proposed_verifier` describes," not "has anyone worked on this general area."
- **Output**: append a `novelty_check` block to each gate-1-5-passing candidate in `knowledge/candidates_scored.md`: `{searched: [queries run], found_conflict: true|false, conflict_note: "..." | null}`.
- If `found_conflict: true`, the candidate's final verdict flips to `REJECTED (superseded)` regardless of gates 1-5 — do not carry it into Stage 4.
- If a search cannot be completed (e.g. a paywalled/login-gated citation index), do not treat that as a pass — record it as `found_conflict: unverified` and treat unverified the same as a fail for the purposes of proceeding to Stage 4. Silence is not confirmation.

### Stage 4: Topic Brief Compilation
For each candidate that is `ADMITTED` *and* cleared gate 6 (cap at top 3, ranked by how concrete gate 2's verifier design is):
- **Persona**: `methodologist`
- **Output**: `topics/<candidate_id>/brief.md` containing:
  - **Hypothesis**: the specific, falsifiable claim to test.
  - **Why open**: the gate-1 citation and quote.
  - **Verifier design**: the exact script/comparison that decides pass/fail, including which baseline(s) it must beat and by how much to count as a real result (not just noise).
  - **Compute estimate**: expected wall-clock per experiment run.
  - **Novelty check**: the gate-6 result — queries run in Stage 3.5 and why they didn't turn up a conflict. This is a report of what was actually searched, not a vague "probably fine" note.

### Stage 5: Selection Handoff
- Present the ranked `ADMITTED` briefs. Recommend the top one, but wait for explicit confirmation before treating it as final.
- On confirmation, copy the chosen `topics/<candidate_id>/brief.md` into the `ai-scientist` workspace as the seed for `garden/ai-scientist` Phase 1 (`knowledge/` + `task.md`) — this skill's output is that pipeline's input, not a replacement for it.

---

## Orchestration Example

```json
{
  "subagent_id": "topic_sweep_bandits",
  "persona": "literature_scout",
  "goal": "Search recent (2024-2026) online-learning/bandit literature. Extract verbatim Limitations/Future Work quotes into knowledge/candidates_raw.md. Stop at 10-15 candidates.",
  "max_steps": 40
}
```

## Output Structure

```text
knowledge/
  candidates_raw.md          (Stage 1: verbatim quotes + sources)
  candidates_structured.json (Stage 2: structured candidate objects)
  candidates_scored.md       (Stage 3 + 3.5: gate-by-gate verdicts, including novelty_check)
topics/
  cand_003/
    brief.md                 (Stage 4: final proposal for an ADMITTED candidate)
  cand_007/
    brief.md
```

## Troubleshooting
- **Nothing survives Stage 3**: this is a valid outcome, not a bug — it means the subfield sweep didn't turn up a real gap. Re-run Stage 1 with a narrower or adjacent subfield rather than loosening the gates.
- **Every candidate fails gate 2 (verifiability)**: likely sign the subfield itself trends toward subjective/qualitative claims. Prefer subfields with a standard quantitative metric (regret, accuracy, approximation ratio) baked into how the field reports results.
- **Gate 6 finds a conflict**: don't try to differentiate the candidate from the conflicting work to save it (e.g. "ours is slightly different because..."). Reject it and either move to the next-ranked candidate or re-run Stage 1. A close variant of already-published work is not what gate 6 is for salvaging.
- **Gate 6 comes back `unverified` for every candidate** (e.g. citation index consistently paywalled): don't silently treat unverified as pass. Note the tooling gap and, if it can't be resolved, say so explicitly when handing off in Stage 5 rather than presenting an unconfirmed candidate as clean.
- **Candidate looks admitted but the verifier design in Stage 4 is vague**: send it back to Stage 3 — an admitted candidate must have a verifier concrete enough to become a literal `verify_cmd` for a Ralph loop, not just a description of one.
