name: multi-agent-simulation
description: Orchestrates multi-agent collaboration workflows (e.g., Debate, Refine, Swarm). Use when user asks to "simulate a debate between agents", "run a multi-agent simulation", "have agents discuss this topic", or "assign roles to solve this task".
---

# Multi-Agent Simulation (Orchestration Pattern)

## Requirements
- subagent
- blackboard
- plan_task

This skill defines how to simulate complex multi-agent collaboration patterns within Aura OS's single-agent architecture using "time-slicing" and "process isolation".

---

## Core Principle: Cognitive Sharding

1. **Process Isolation**: Each `subagent` call starts an independent kernel loop.
   - **Environment Variables**: System automatically injects `AURA_SUBAGENT_ID` and `AURA_SUBAGENT_DEPTH`.
   - **Recursion Sentinel**: `MAX_SUBAGENT_DEPTH=2`.
2. **Persona Projection**:
   - **Persona Mode**: Specify `persona` during call to auto-load `instructions` from `state/personas/{persona}.json`.
   - **Goal Mode**: Use `[ROLE: Name]` tag for immediate identity biasing.
3. **Message Bus (Blackboard)**: Child processes share data via `state/bus/`, supporting atomic writes and exclusive locks.

Available Personas: `architect`, `coder`, `reviewer`, `refiner`, `judge`, `debater`, `diagnostician`.

---

## Main Execution Flow: Orchestrator Workflow

As the Main Agent (Orchestrator), your core responsibility is not to solve problems directly, but to **plan structure, dispatch tasks, and synthesize results**.

### Phase 1: Planning
**Goal**: Determine the topology of multi-agent collaboration (e.g., linear pipeline or parallel sharding?).
- **Tool Call**: Use `plan_task` to record and sync the overall blueprint.
- **Example**: `plan_task: {"plan": "1. Architect designs interface; 2. Coder implements A/B modules in parallel; 3. Judge accepts results"}`

### Phase 2: Orchestration
**Goal**: Schedule child processes and manage their lifecycle.
- **Execution**: Loop calling `subagent` (synchronous or asynchronous).
- **Information Flow**:
  - Use `blackboard` as shared memory slots.
  - Each `subagent`'s `goal` must include a reference to blackboard data (e.g., "Write code based on blackboard design_spec").

### Phase 3: Synthesis
**Goal**: Combine dispersed outputs from all child processes into a final response.
- **Process**: Read `blackboard: {"action": "list"}` -> Dispatch summary Subagent (Persona: `refiner`) -> Produce final task output.

---

## Scenarios & Tool Usage (6 Major Patterns)

### 1. Best-of-N Sampling

**Goal**: Parallel sampling to select the highest quality output.

```
Step 1 — Dispatch Parallel Tasks:
  {"goal": "Implement Quicksort, optimize recursion depth for large data", "async_mode": true, "name": "gen_1", "max_steps": 10}
  {"goal": "Implement Quicksort, optimize recursion depth for large data", "async_mode": true, "name": "gen_2", "max_steps": 10}

Step 2 — Status Polling:
  {"action": "status", "job_id": "gen_1_xxxx"}
  {"action": "status", "job_id": "gen_2_xxxx"}

Step 3 — Judge Decision:
  {"persona": "judge", "goal": "Compare outputs of gen_1 and gen_2 (see blackboard), select the winner and write to blackboard key=winner"}
```

---

### 2. Iterative Refinement

**Goal**: Polish the final draft through continuous feedback loops.

```
Loop (until satisfied):
  1. subagent: {"persona": "reviewer", "goal": "Review current draft.md, provide 3 potential bugs", "max_steps": 5}
  2. blackboard: {"action": "write", "key": "review_feedback", "content": {"bugs": [...]}}
  3. subagent: {"persona": "refiner", "goal": "Modify code based on blackboard review_feedback, produce improved draft.md", "max_steps": 8}
  4. blackboard: {"action": "delete", "key": "review_feedback"}
```

---

### 3. Hierarchical Decomposition (MetaGPT Pattern)

**Goal**: Architect → Coder → Tester pipeline division.

```
Step 1 — Architecture Design:
  subagent: {"persona": "architect", "goal": "Design file structure and interface definition for auth module, output to blackboard key=design_spec", "max_steps": 8}

Step 2 — Implementation (Parallel Multi-file):
  subagent: {"persona": "coder", "goal": "Implement auth/login.py based on blackboard design_spec", "max_steps": 12}
  subagent: {"persona": "coder", "goal": "Implement auth/register.py based on blackboard design_spec", "max_steps": 12}

Step 3 — Code Review:
```
