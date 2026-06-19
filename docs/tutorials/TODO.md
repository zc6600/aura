# Tutorials TODO

This backlog tracks hands-on tutorials that should become real, runnable walkthroughs. Each item should produce a concrete artifact in a fresh workspace and should avoid becoming a reference page.

## Selection Rules

A tutorial candidate is ready to write when it has:

- A clear learner outcome.
- A fresh-workspace setup path.
- Commands the reader can run locally.
- A visible final artifact or behavior.
- A small verification step.
- Links out to how-to, reference, and explanation pages instead of explaining every detail inline.

## High Priority

### Optimize a Slow Function From Scratch

Status: promoted to [Optimize a Slow Function with Ralph Mode](optimize-slow-function.md).

Goal: start with a deliberately slow pure-Python function, ask Aura to optimize it without changing behavior, and verify both correctness and speed. This is the first production-style tutorial because the result is visible, local, deterministic, and does not need external services beyond the LLM.

Final visible result:

```text
Correctness: passed
Baseline:    1.20s
Optimized:   0.18s
Speedup:     6.6x
```

Workspace created by the tutorial:

```text
aura-perf-demo/
├── src/
│   └── similarity.py
├── benchmark.py
├── test_similarity.py
├── task.md
├── skills/
│   └── performance-optimizer/
│       └── SKILL.md
└── perf_report.md              # created by the agent
```

Starter `src/similarity.py`:

```python
def unique_token_overlap(left: str, right: str) -> float:
    """Return Jaccard overlap of unique lowercase tokens."""
    left_tokens = []
    for token in left.lower().split():
        if token not in left_tokens:
            left_tokens.append(token)

    right_tokens = []
    for token in right.lower().split():
        if token not in right_tokens:
            right_tokens.append(token)

    intersection = 0
    for token in left_tokens:
        if token in right_tokens:
            intersection += 1

    union = len(left_tokens)
    for token in right_tokens:
        if token not in left_tokens:
            union += 1

    if union == 0:
        return 1.0
    return intersection / union
```

Starter `test_similarity.py`:

```python
from src.similarity import unique_token_overlap


def approx(a, b):
    return abs(a - b) < 1e-9


assert approx(unique_token_overlap("", ""), 1.0)
assert approx(unique_token_overlap("A B C", "a b c"), 1.0)
assert approx(unique_token_overlap("a b c", "b c d"), 0.5)
assert approx(unique_token_overlap("a a a b", "a b b b"), 1.0)
print("Correctness: passed")
```

Starter `benchmark.py`:

```python
import time
from src.similarity import unique_token_overlap


LEFT = " ".join([f"token{i % 500}" for i in range(8000)])
RIGHT = " ".join([f"token{i % 700}" for i in range(8000)])

start = time.perf_counter()
for _ in range(80):
    unique_token_overlap(LEFT, RIGHT)
elapsed = time.perf_counter() - start

print(f"Elapsed: {elapsed:.4f}s")
if elapsed > 0.35:
    raise SystemExit("Benchmark failed: implementation is still too slow")
```

Starter `task.md`:

```markdown
# Task

Optimize `src/similarity.py`.

Constraints:
- Keep `unique_token_overlap(left, right)` public API unchanged.
- Preserve all behavior checked by `test_similarity.py`.
- Do not change benchmark thresholds.
- Write `perf_report.md` with the original issue, the implementation change, and the final benchmark result.
```

Starter `skills/performance-optimizer/SKILL.md`:

```markdown
---
name: performance-optimizer
description: Use when optimizing a slow function while preserving behavior.
---

# Performance Optimizer

Read `task.md` first.

Workflow:
1. Run `python test_similarity.py`.
2. Run `python benchmark.py` and observe the failure or baseline time.
3. Inspect the target implementation.
4. Optimize the implementation without changing the public API.
5. Re-run both commands.
6. Write `perf_report.md` with before/after reasoning and the final result.
```

Runnable command path:

```bash
aura new aura-perf-demo
cd aura-perf-demo
mkdir -p src skills/performance-optimizer
# write the starter files above
python test_similarity.py
python benchmark.py
aura session create perf-demo
aura agent \
  --mode ralph \
  --goal "Use the performance-optimizer workflow to complete task.md" \
  --verify "python test_similarity.py && python benchmark.py" \
  --non-interactive
python test_similarity.py
python benchmark.py
cat perf_report.md
```

Acceptance criteria:

- The initial `python test_similarity.py` passes.
- The initial `python benchmark.py` fails because the implementation is too slow.
- After Aura runs, `python test_similarity.py && python benchmark.py` exits with code `0`.
- `src/similarity.py` uses a better algorithm, likely `set` operations.
- `perf_report.md` exists and explains the change.

Why it matters: this shows the full productive loop with almost no scaffolding: baseline measurement, agent reasoning, code change, verification, and a written engineering report.

Related docs:

- [Build Your First Tool and Skill](first-tool.md)
- [Manage Sessions](../how-to/manage-sessions.md)
- [Testing Strategy](../explanation/testing-strategy.md)
- [Tools, Skills, Garden, and MCP](../explanation/tools-skills-and-mcp.md)

### Use Ralph Mode for a Test-Driven Fix

Goal: teach the Ralph loop through a tiny failing test and a deterministic verification command.

Expected artifact:

```text
src/calculator.js
test.js
```

Suggested flow:

1. Create a workspace with a small JavaScript file and failing test.
2. Run the test manually.
3. Run `aura agent --mode ralph --goal "Fix the calculator test" --verify "node test.js" --non-interactive`.
4. Inspect the final diff and test output.

Why it matters: Ralph mode is powerful but hard to understand from reference material alone.

Related docs:

- [CLI Reference](../reference/cli.md)
- [Workspace and Template Model](../explanation/workspace-and-template-model.md)

### Create a Project-Specific Review Agent

Goal: customize workspace prompts and skills so Aura reviews one codebase with local conventions.

Expected artifact:

```text
AGENTS.md
skills/project-review/SKILL.md
sample.js
```

Suggested flow:

1. Create local code-style rules in `AGENTS.md`.
2. Create a review skill with a checklist.
3. Ask Aura to review `sample.js`.
4. Verify the output references local conventions.

Why it matters: shows how workspace instructions and skills change agent behavior without changing core code.

Related docs:

- [Context and State](../explanation/context-and-state.md)
- [Tools, Skills, Garden, and MCP](../explanation/tools-skills-and-mcp.md)

## Medium Priority

### Build a Multi-Session Research Workflow

Goal: use separate sessions for research, implementation, and review.

Expected artifact:

```text
notes/research.md
task.md
```

Suggested flow:

1. Create `research-topic`, `implementation`, and `review` sessions.
2. Use `aura chat` or `aura agent` in each session.
3. Export one session database.
4. Switch back to the implementation session and continue.

Why it matters: sessions are a core Aura concept, but a multi-session workflow makes the isolation model tangible.

Related docs:

- [Manage Sessions](../how-to/manage-sessions.md)
- [Session Architecture](../explanation/session-architecture.md)

### Add an MCP SQLite Tool to Inspect Session State

Goal: configure a local MCP SQLite server and query the active session database.

Expected artifact:

```text
.aura-workspace/tools/mcp/config.yml
```

Suggested flow:

1. Create a workspace and run a short agent/chat session.
2. Configure MCP SQLite against `.aura-workspace/state/sessions/default.db`.
3. Run `aura tools list`.
4. Query recent events through `aura kernel run_call mcp.sqlite.query ...`.

Why it matters: demonstrates how external tools can inspect Aura state.

Related docs:

- [Integrations Reference](../reference/integrations.md)
- [Extend with Skills, Tools, and Garden](../how-to/extend-with-skills-and-tools.md)

### Publish a Reusable Skill Locally

Goal: create a skill in one directory and install it into another workspace.

Expected artifact:

```text
my-review-skill/SKILL.md
```

Suggested flow:

1. Create a standalone skill folder outside the workspace.
2. Install it with `aura skill install ../my-review-skill`.
3. List skills in the target workspace.
4. Use the skill in an agent goal.

Why it matters: turns skills from local files into reusable assets.

Related docs:

- [Build Your First Tool and Skill](first-tool.md)
- [Extend with Skills, Tools, and Garden](../how-to/extend-with-skills-and-tools.md)

## Lower Priority

### Customize Templates and Pull Them Into a New Workspace

Goal: modify global templates, sync them, and observe a new workspace receiving them.

Why it matters: explains template propagation by doing it.

Related docs:

- [Work with Templates and Updates](../how-to/work-with-templates-and-updates.md)
- [Workspace and Template Model](../explanation/workspace-and-template-model.md)

### Build a Local Tool Group

Goal: use `aura tools generate_group` to create a contextual tool group and inspect the generated files.

Why it matters: group tools are harder to infer from standalone tool tutorials.

Related docs:

- [Kernel Reference](../reference/kernel.md)
- [Tools, Skills, Garden, and MCP](../explanation/tools-skills-and-mcp.md)

### First Web Dashboard Session

Goal: start `aura web`, open a workspace, and observe agent progress from the web interface.

Why it matters: gives the web command a practical learning path.

Related docs:

- [CLI Reference](../reference/cli.md)
- [Daemon Architecture](../explanation/daemon-architecture.md)

## Writing Checklist

Before turning an item into a tutorial:

- Keep it runnable in a temporary workspace.
- Prefer files created by the tutorial over existing repo-specific files.
- Avoid paid-provider dependency until the final optional agent step when possible.
- Include cleanup notes only if the tutorial creates global state.
- Link to reference pages for command details.
- Link to explanation pages for the model behind the workflow.
