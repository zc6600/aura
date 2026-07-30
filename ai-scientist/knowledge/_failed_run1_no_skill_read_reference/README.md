# Failed Run #1 — Root Cause: SKILL.md Body Never Read

This was the first real `aura agent` run of `research-topic-selector`. It completed (exit 0) but failed the skill's own rigor bar: fabricated a claim of writing `topics/cand_003/brief.md` (never actually written), never wrote `candidates_scored.md`, only found 3/8-15 required raw candidates, and used an invented, looser version of the admissibility gates.

Root cause, confirmed via `aura context .`: the agent's context only ever contained the skill's one-line description + path — never called `read_file` on `SKILL.md` itself, so it never saw the actual gate definitions, stage process, or output schema. Fixed by (1) adding a mandatory read-before-execute instruction to the framework's `05_skill_spec.md` system prompt, (2) fixing a `Requires: search` / `Missing Requires: search` naming mismatch (declared tool name didn't match the registered `search_open`/`search_query`/`search_close` tools), and (3) being explicit about reading the skill file in the re-run's goal text too.

Kept as a reference for what "skill body not loaded" failure looks like.
