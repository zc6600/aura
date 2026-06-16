# Optimize a Slow Function with Ralph Mode

This tutorial builds a small performance task from scratch, then uses Ralph mode to improve the implementation until a correctness test and a benchmark both pass.

You will create:

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
└── perf_report.md
```

The visible result is a working optimization loop:

```text
Correctness: passed
Elapsed: 0.0...s
```

Ralph mode is useful here because the task has a clear verification command:

```bash
python test_similarity.py && python benchmark.py
```

## Prerequisites

You need:

- Aura installed and built.
- Python 3.
- A real LLM provider configured. The default `local` provider is an offline mock and cannot perform the optimization.

If needed:

```bash
aura env set OPENROUTER_API_KEY your-key --global
aura config llm.provider openrouter --global
```

## Create the Workspace

```bash
aura new aura-perf-demo
cd aura-perf-demo
mkdir -p src skills/performance-optimizer
```

## Add the Slow Implementation

Create `src/similarity.py`:

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

This implementation is intentionally slow because it repeatedly checks membership in Python lists.

## Add Correctness Checks

Create `test_similarity.py`:

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

Run it:

```bash
python test_similarity.py
```

Expected result:

```text
Correctness: passed
```

## Add the Benchmark

Create `benchmark.py`:

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

Run it once:

```bash
python benchmark.py
```

The first run should fail with:

```text
Benchmark failed: implementation is still too slow
```

That failure is the point of the tutorial. Ralph will use it as the feedback signal.

## Add the Task

Create `task.md`:

```markdown
# Task

Optimize `src/similarity.py`.

Constraints:
- Keep `unique_token_overlap(left, right)` public API unchanged.
- Preserve all behavior checked by `test_similarity.py`.
- Do not change benchmark thresholds.
- Write `perf_report.md` with the original issue, the implementation change, and the final benchmark result.
```

## Add the Workflow Skill

Create `skills/performance-optimizer/SKILL.md`:

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

Confirm Aura sees the skill:

```bash
aura skill list
```

## Run Ralph Mode

Create a dedicated session:

```bash
aura session create perf-demo
```

Run the optimization:

```bash
aura agent \
  --mode ralph \
  --goal "Use the performance-optimizer workflow to complete task.md" \
  --verify "python test_similarity.py && python benchmark.py" \
  --non-interactive
```

Ralph should edit `src/similarity.py`, run the verification command, and continue until it passes or reaches the step limit.

## Verify the Result

Run the checks yourself:

```bash
python test_similarity.py
python benchmark.py
cat perf_report.md
```

A typical optimized implementation uses set operations:

```python
def unique_token_overlap(left: str, right: str) -> float:
    """Return Jaccard overlap of unique lowercase tokens."""
    left_tokens = set(left.lower().split())
    right_tokens = set(right.lower().split())
    union = left_tokens | right_tokens
    if not union:
        return 1.0
    return len(left_tokens & right_tokens) / len(union)
```

## What You Learned

- Ralph mode works best when success can be measured by a command.
- A tutorial workflow can be small but still productive: measure, change, verify, report.
- Skills can define the operating procedure while `--verify` supplies the hard stop condition.
- Performance tutorials should preserve behavior first and optimize second.

## Troubleshooting

### Aura says the local provider is offline

Configure a real LLM provider. Ralph mode cannot optimize code with the default local mock provider.

### The LLM provider reports a quota or rate-limit error

Wait for quota reset or switch to a provider/key with enough quota, then rerun the Ralph command. The local correctness and benchmark commands can still be used to inspect any partial changes.

### The benchmark passes before Aura runs

Your machine is faster than the tutorial threshold. Lower the threshold in `benchmark.py` after measuring the slow baseline, or increase the loop count from `80` to `160`.

### The benchmark still fails after Aura runs

Run:

```bash
python test_similarity.py && python benchmark.py
```

Then rerun Ralph with a more direct goal:

```bash
aura agent \
  --mode ralph \
  --goal "Optimize unique_token_overlap using sets. Keep tests passing and write perf_report.md." \
  --verify "python test_similarity.py && python benchmark.py" \
  --non-interactive
```

See [CLI Reference](../reference/cli.md), [Testing Strategy](../explanation/testing-strategy.md), and [Tools, Skills, and MCP](../explanation/tools-skills-and-mcp.md) for the underlying mechanics.
