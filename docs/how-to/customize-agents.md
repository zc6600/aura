# Customize Agents with Garden

This guide shows how to turn a real task into a project-specific agent in Aura. Use it when a workspace needs a repeatable role, workflow, tool boundary, anchor graph, or verification loop instead of a one-off prompt.

Garden is the main design surface for this work. A Garden playbook answers: "How should this task become an agent-executable project?" It designs the meta agent, chooses which actions become tools, defines progress anchors, wires skills and prompts, and explains how the agent should move through the work.

AutoKaggle is the reference pattern: the Garden assembles the competition workspace, guarded submit tools, leaderboard registry, Ralph verifier, anchors, prompts, and the internal `auto-kaggle` skill. The same shape applies to code audit agents, benchmark agents, research agents, migration agents, and other long-running workflows.

## Choose the Right Layer

Aura customization works best when each concern goes into the right layer:

| Need | Use | Why |
|------|-----|-----|
| Tone, role, priorities | `prompts/system/SOUL.md` | Always-on persona and operating posture |
| Tool-use rules and safety boundaries | `prompts/system/TOOLS.md` | Always-on local tool discipline |
| Domain procedure | `skills/<name>/SKILL.md` | Reusable operating procedure the agent can discover and follow |
| Agent project design | `garden/<name>/garden.md` | Meta-agent design, workspace scaffold, stage model, anchors, tools, prompts, and skill routing |
| Runnable workflow contract | `workflow.yml` | The user-facing run/status/doctor contract for the custom agent project |
| Deterministic operation | `tools/<name>/logic.py` | Reliable executable action with JSON input/output |
| External service | MCP or a local tool wrapper | Keep API details outside free-form prompt text |
| Must-pass verification | Ralph mode | Agent attempts are rejected until verifier/critic passes |
| Progress milestones | `anchors/*.json` and `anchor_submit` | Checkpoint state visible to `aura garden status` |
| Large-file guidance | `.hint` files and `@aura-hint` | Keep context small while preserving intent |

Do not put everything into a single prompt. Prompts are good for behavior; tools are for facts and irreversible actions. Garden is where the pieces are composed into an executable agent project.

`workflow.yml` is the runnable contract on top of those pieces. It does not replace Garden, skills, tools, or anchors; it points to them so Aura can validate, show status, and compile a consistent run goal.

`aura workflow run` is the user-facing command. Under the hood it uses the same kernel receiver exposed as `aura kernel workflow`, so workflow execution is a core Aura input path rather than only a CLI convenience.

## Garden Design Workflow

Use this sequence when designing a new Garden:

1. Define the user-facing task in one sentence.
2. Identify the meta agent role: what the agent is responsible for, what it must never do directly, and when it should stop.
3. Split the workflow into stages that can be observed: setup, inspect, plan, act, verify, record, decide next, stop.
4. Decide which actions require deterministic tools. Anything irreversible, external, expensive, or stateful should be behind a tool or verifier.
5. Decide what belongs in a skill. Put reusable judgment and procedure in `skills/<name>/SKILL.md`, not in tool code.
6. Define anchors for milestones that should survive across turns and sessions.
7. Add system prompts for persona and tool discipline.
8. Add Ralph verification when a stage needs a must-pass check.
9. Run `aura kernel observe`, `aura garden status`, and one dry-run goal to confirm the context is discoverable.

For example, AutoKaggle maps the task "run a Kaggle competition until configured stop conditions" into:

- A Garden that assembles the competition workspace, stage gates, prompts, anchors, tools, and `auto-kaggle` skill.
- Tools for Kaggle download/submission, experiment registry, submit guard, and waiting.
- Anchors for workspace ready, validation frozen, submission loop started, and feedback recorded.
- Ralph verification before real submission.
- A skill that tells the agent how to operate within that assembled context.

## Workspace Layout

Create or use an Aura workspace:

```bash
aura new my-project
cd my-project
```

Recommended customization layout:

```text
my-project/
├── prompts/
│   ├── system/
│   │   ├── SOUL.md
│   │   └── TOOLS.md
│   └── ralph/
│       ├── ralph_system.md
│       └── critic_rules.md
├── skills/
│   └── my-agent/SKILL.md
├── garden/
│   ├── garden.md
│   └── my-agent/garden.md
├── workflow.yml
├── tools/
│   └── my_tool/
│       ├── manifest.json
│       ├── logic.py
│       └── logic.py.hint
├── anchors/
│   └── 00_ready.json
├── knowledge/
├── task.md
└── .aura-workspace/
```

Aura discovers root-level `tools/`, `skills/`, `garden/`, `prompts/`, `anchors/`, and hints from the active workspace. The hidden `.aura-workspace/` stores runtime state, config, template content, and sessions.

## Add a Workflow Contract

Create `workflow.yml`:

```yaml
version: 1
name: my-agent
description: Project-specific agent workflow.

params:
  path: params/my-agent.yml

context:
  garden: garden/my-agent/garden.md
  skill: skills/my-agent/SKILL.md
  prompts:
    - prompts/system/SOUL.md
    - prompts/system/TOOLS.md

tools:
  required:
    - my_tool

stages:
  - id: ready
    title: Workspace ready
    anchor: anchors/00_ready.json

registry:
  db_path: ".aura-workspace/state/experiments.db"
  metrics:
    - name: cv_score
      higher_is_better: true

run:
  mode: classic
  max_steps: 20
  goal: |
    Use the my-agent Garden for project context.
    Follow the my-agent Skill operating procedure.
    Read params/my-agent.yml before acting.
    Use required tools for deterministic actions.
    Stop when the configured stop condition is met.
```

Use it through:

```bash
aura workflow doctor
aura workflow status
aura workflow run
```

For multiple workflows, put them under `workflows/<name>.yml` and pass the name, for example `aura workflow run audit`.

## Built-in Experiment Registry

Aura provides a framework-level **Built-in Experiment Registry** so you do not need to write manual SQLite database or table initialization code in your agent projects.

### 1. Declare in `workflow.yml`
You declare the experiment registry database path and metric rules directly in your workflow file:

```yaml
registry:
  db_path: ".aura-workspace/state/experiments.db"
  metrics:
    - name: cv_score
      higher_is_better: true
```

### 2. Built-in Tools for Agents
Agent prompts and LLM loops can directly utilize these framework-level tools:
- `aura.registry.record`: Record/log validation scores, models, parameters, and generated submission artifacts in the experiment registry.
- `aura.registry.best`: Retrieve the run details with the best CV score from the experiment database.

For example, the agent can call `aura.registry.record` with the following parameters:
```json
{
  "run_id": "candidate_001",
  "cv_score": 0.854,
  "hypothesis": "Try learning rate 0.01",
  "model_family": "lightgbm",
  "params": {
    "lr": 0.01,
    "max_depth": 6
  }
}
```

### 3. Using Registry via Python SDK
For external scripts or code running in the workspace (such as your training scripts), the Aura Python SDK exposes the registry interface directly:

```python
from aura_sdk import RunRegistry

# Initialize registry using the configured DB path
registry = RunRegistry(db_path=".aura-workspace/state/experiments.db")

# Record run
registry.record("candidate_001", {
    "cv_score": 0.854,
    "hypothesis": "Try learning rate 0.01",
    "model_family": "lightgbm",
    "params": {"lr": 0.01, "max_depth": 6}
})

# Retrieve a specific run
run = registry.get("candidate_001")
print(run["cv_score"])  # 0.854
```


## Add System Prompts

Use `SOUL.md` for stable identity:

```markdown
# AGENT PERSONA

You are a careful domain operator for this workspace.
You optimize for reproducible work, clear records, and verified outcomes.
```

Use `TOOLS.md` for local tool rules:

```markdown
# TOOL GUIDELINES

- Use deterministic tools for irreversible actions.
- Do not call raw shell commands when a project tool exists.
- If a tool returns a wait/defer status, follow that status before retrying.
- Record important facts in the project registry or milestone system.
```

## Add a Skill

Create `skills/my-agent/SKILL.md`:

```markdown
---
name: my-agent
description: Workflow for this project-specific agent.
requires:
  - my_tool
---

# My Agent Skill

## Operating Rules

- Read project parameters before acting.
- Use `my_tool` for deterministic project actions.
- Record each completed stage.
- Stop when the configured stop condition is met.
```

Skills teach procedure. They should not duplicate tool implementation details.

## Add a Garden Playbook

Create `garden/garden.md`:

```markdown
---
name: garden
description: Workspace Garden router for project-level agent design.
---

# Garden Router

Use `garden/my-agent/garden.md` to assemble the project context, prompts, anchors, tools, and skill.
```

Create `garden/my-agent/garden.md`:

```markdown
---
name: my-agent
description: Garden playbook for turning this project task into an agent-executable workflow.
requires:
  - my_tool
  - anchor_submit
---

# My Agent Garden

## Role

This Garden designs the agent workspace. It defines the meta-agent role, the
stage gates, the required tools, the anchors, and the skill the agent should
follow during execution.

## Meta Agent

The agent is responsible for moving the project through the configured stages,
recording facts, calling deterministic tools for risky actions, and stopping at
the declared stop condition.

The agent must not bypass guard tools or treat unrecorded chat claims as facts.

## Context Assembly

Ensure the workspace has:

- `prompts/system/SOUL.md` for role and posture.
- `prompts/system/TOOLS.md` for tool-use boundaries.
- `skills/my-agent/SKILL.md` for reusable operating procedure.
- `tools/my_tool/` for deterministic project actions.
- `anchors/` for stage milestones.
- `task.md` for the active long-running task.

## Stage Model

1. Read parameters.
2. Run the deterministic tool.
3. Verify the output.
4. Record a milestone.
5. Continue or stop according to the configured condition.
```

Garden playbooks are useful for stage gates, long-running loops, and project-level conventions. They should describe how the workspace is assembled and how the meta agent should execute the project; the detailed reusable procedure can live in `skills/<name>/SKILL.md`.

## Design Anchors

Anchors are the durable milestone layer for Garden workflows. Create one anchor per stage that the agent should explicitly mark or report.

Create `anchors/00_ready.json`:

```json
{
  "id": "00_ready",
  "title": "Workspace ready",
  "call_when": [
    "Required prompts, skill, tools, Garden playbook, and task file are present."
  ]
}
```

Create stage-specific anchors as the Garden becomes more concrete:

```text
anchors/
├── 00_ready.json
├── 10_inputs_cataloged.json
├── 20_verification_passed.json
└── 30_feedback_recorded.json
```

Use `aura garden status` to inspect these milestones. If the project has a custom `anchor_submit` tool, instruct the agent in the Garden and skill when to call it.

## Add a Deterministic Tool

Create `tools/my_tool/manifest.json`:

```json
{
  "name": "my_tool",
  "description": "Performs one deterministic project action.",
  "runtime": "python3",
  "entry": "logic.py",
  "auto_load": true,
  "permissions": {
    "file_system": "read-write",
    "allow_paths": ["./reports", "./state", "./params"]
  },
  "input_schema": {
    "type": "object",
    "properties": {
      "action": { "type": "string" },
      "payload": { "type": "object" }
    },
    "required": ["action"]
  },
  "memory": {
    "retention": "ephemeral",
    "summarize": true,
    "max_steps": 5
  }
}
```

Create `tools/my_tool/logic.py`:

```python
#!/usr/bin/env python3
import json
import sys

def main():
    try:
        args = json.loads(sys.stdin.read() or "{}")
        print(json.dumps({"status": "ok", "action": args.get("action")}))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)}))

if __name__ == "__main__":
    main()
```

Tool output must be a single JSON object. Avoid printing secrets or long raw logs.

## Decide Tool Boundaries

Use tools for actions where prompt discipline is not enough:

- External API calls, submissions, deployment, billing, or destructive changes.
- Reads from large or structured sources where the agent should receive a compact JSON summary.
- Writes to registries, ledgers, experiment logs, or audit trails.
- Guard checks that must run before an irreversible action.
- Waiting, polling, or resume decisions that should be represented as structured state.

Do not make a tool for every small shell command. A good Garden names the few boundaries where determinism, permissions, or structured output matter.

## Use Ralph for Must-Pass Work

Use Ralph when the agent should keep trying until an external verifier passes:

```bash
aura kernel ralph \
  --goal "Fix the implementation until tests pass" \
  --verify "npm test" \
  --max-steps 5
```

Ralph is not just a tool call. It is a verification-driven loop:

1. A developer agent attempts the task.
2. A physical verifier or critic checks the result.
3. If verification fails, the next agent attempt receives the failure recap.
4. The loop completes only when the agent finishes and verification passes.

Ralph writes a structured result artifact:

```text
.aura-workspace/state/ralph/runs/<ralph_run_id>/result.json
```

The CLI stdout also returns the result JSON:

```json
{
  "status": "completed",
  "run_id": "20260617...",
  "result_path": ".aura-workspace/state/ralph/runs/20260617.../result.json",
  "verification": {
    "mode": "physical",
    "passed": true,
    "command": "npm test",
    "exit_code": 0,
    "stdout_tail": "...",
    "stderr_tail": "..."
  }
}
```

Downstream tools can consume `result_path` as proof that a verifier passed.

## Customize Ralph Prompts

Use `prompts/ralph/ralph_system.md` for developer-agent rules:

```markdown
# Ralph Developer Rules

- Make the smallest change that can pass the verifier.
- Do not bypass or weaken the verifier.
- Preserve project-specific contracts.
```

Use `prompts/ralph/critic_rules.md` for critic checks:

```markdown
# Ralph Critic Rules

Return completed=true only when the output satisfies the project contract.
Explain concrete fixes when completed=false.
```

## Verify Discovery

Run:

```bash
aura tools list
aura skill list
aura garden list
aura garden status
aura workflow doctor
aura workflow status
aura kernel observe
```

If an item is missing, check that it is under the workspace root, not only inside an external template or use-case directory.

## Run the Agent

Start with a dry run through the workflow contract:

```bash
aura workflow run
```

If you need an ad hoc goal, `aura agent --goal` still works. Prefer `aura workflow run` for repeatable custom agent projects because it checks the declared params, context, tools, and stages first.

```bash
aura agent --goal "
Run this project according to garden/my-agent/garden.md and skills/my-agent/SKILL.md.
Use deterministic tools for guarded actions.
Stop when the configured stop condition is met.
"
```

## Practical Design Rules

- Put user-editable parameters in `params/*.yml` or a similar obvious location.
- Put repeatable facts in a registry file or database, not only in chat history.
- Put irreversible operations behind a guard tool.
- Put project assembly and stage design in Garden.
- Put reusable operating procedure in a skill.
- Use Ralph for verifier-backed work, not for ordinary exploration.
- Use `.hint` files for large datasets, binary files, or generated artifacts.
- Keep tools narrow. A tool should do one project action and return structured JSON.
- Keep skills and gardens readable. They are operating instructions and project design, not code.
