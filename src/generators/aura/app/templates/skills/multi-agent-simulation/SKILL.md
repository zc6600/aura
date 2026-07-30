---
name: multi-agent-simulation
description: Simulate multi-agent collaborative workflows (MetaGPT/Refine/Swarm/Debate patterns). Orchestrates subagents with isolated contexts and role instructions for task-level specialization.
requires:
  - subagent
  - blackboard
  - plan_task
---

# Multi-Agent Simulation (Orchestration Pattern)

This skill defines how to simulate complex multi-agent collaboration patterns within Aura OS using time-slicing and process isolation.

---

## Core Principle: Cognitive Sharding

1. **Process Isolation**: Each `subagent` invocation launches an independent kernel execution loop.
   - **Environment Variables**: System automatically injects `AURA_SUBAGENT_ID` and `AURA_SUBAGENT_DEPTH`.
   - **Recursion Guard**: `MAX_SUBAGENT_DEPTH=2`.
2. **Persona Projection**:
   - **Persona Mode**: Specifies `persona` during invocation to load corresponding instructions from `state/personas/{persona}.json`.
   - **Goal Mode**: Uses inline identity tags such as `[ROLE: Name]` to bias model perspective.
3. **Message Bus (Blackboard)**: Processes share structured state via `state/bus/` with atomic writes and lock support.

Available Personas: `architect`, `coder`, `reviewer`, `refiner`, `judge`, `debater`, `diagnostician`.

---

## Main Workflow: Orchestrator Pattern

As the primary Orchestrator agent, your core responsibility is to **plan topology, dispatch tasks, and synthesize outcomes**.

### Phase 1: Planning
**Goal**: Determine the collaboration topology (e.g., sequential pipeline vs. parallel fan-out).
- **Tool Call**: Use `plan_task` to record and synchronize the multi-agent blueprint.
- **Example**: `plan_task: {"plan": "1. Architect designs interface; 2. Coder implements A/B modules in parallel; 3. Judge reviews results"}`

### Phase 2: Orchestration & Dispatch
**Goal**: Schedule child processes and manage their lifecycles.
- **Execution**: Interactively call `subagent` (synchronously or asynchronously).
- **Data Flow**:
  - Use `blackboard` as shared memory slots.
  - Every `subagent`'s `goal` must reference blackboard slots (e.g., "Implement code based on blackboard design_spec").

### Phase 3: Synthesis & Closure
**Goal**: Consolidate outputs from child processes to produce the final response.
- **Workflow**: Read `blackboard: {"action": "list"}` -> Dispatch synthesizer subagent (Persona: `refiner`) -> Produce final deliverable.

---

## Scenario Patterns & Tool Invocation (6 Core Patterns)

### 1. Best-of-N Sampling

**Goal**: Sample in parallel and select the highest quality output.

```
Step 1 — Dispatch parallel subagents:
  {"goal": "Implement QuickSort and optimize recursion depth", "async_mode": true, "name": "gen_1", "max_steps": 10}
  {"goal": "Implement QuickSort and optimize recursion depth", "async_mode": true, "name": "gen_2", "max_steps": 10}

Step 2 — Status Polling:
  {"action": "status", "job_id": "gen_1_xxxx"}
  {"action": "status", "job_id": "gen_2_xxxx"}

Step 3 — Adjudication:
  {"persona": "judge", "goal": "Compare outputs of gen_1 and gen_2 on blackboard, select winner and write to blackboard key=winner"}
```

---

### 2. Iterative Refinement

**Goal**: Polish deliverables through continuous feedback loops.

```
Loop (until target quality reached):
  1. subagent: {"persona": "reviewer", "goal": "Review current draft.md, identify top 3 potential bugs", "max_steps": 5}
  2. blackboard: {"action": "write", "key": "review_feedback", "content": {"bugs": [...]}}
  3. subagent: {"persona": "refiner", "goal": "Modify code based on review_feedback on blackboard, output updated draft.md", "max_steps": 8}
  4. blackboard: {"action": "delete", "key": "review_feedback"}
```

---

### 3. Hierarchical Decomposition (MetaGPT)

**Goal**: Pipeline division of labor: Architect -> Coder -> Tester.

```
Step 1 — Architecture Design:
  subagent: {"persona": "architect", "goal": "Design auth module structure and interfaces, write to blackboard key=design_spec", "max_steps": 8}

Step 2 — Coding Implementation (Parallel Multi-file):
  subagent: {"persona": "coder", "goal": "Implement auth/login.py based on blackboard design_spec", "max_steps": 12}
  subagent: {"persona": "coder", "goal": "Implement auth/register.py based on blackboard design_spec", "max_steps": 12}

Step 3 — Code Review:
  subagent: {"persona": "reviewer", "goal": "Review all new files in auth/ directory and provide improvement feedback", "max_steps": 6}
```

---

### 4. Swarm Fan-Out

**Goal**: Multiple specialists process separate subtasks in parallel, followed by synthesis.

```
Step 1 — Orchestrator writes task manifest to blackboard:
  blackboard: {"action": "write", "key": "task_manifest", "content": {"tasks": ["Optimize database queries", "Fix UI styles", "Write API docs"]}}

Step 2 — Dispatch parallel specialists:
  subagent: {"goal": "Complete subtask: Optimize DB queries, write output to blackboard key=result_db", "async_mode": true, "name": "expert_db", "max_steps": 15}
  subagent: {"goal": "Complete subtask: Fix UI styles, write output to blackboard key=result_fe", "async_mode": true, "name": "expert_fe", "max_steps": 15}
  subagent: {"goal": "Complete subtask: Write API docs, write output to blackboard key=result_doc", "async_mode": true, "name": "expert_doc", "max_steps": 15}

Step 3 — Poll status and consolidate:
  blackboard: {"action": "list", "key": "*"}
  subagent: {"goal": "Synthesize outputs from result_db, result_fe, result_doc blackboard keys and generate final report", "max_steps": 8}

Step 4 — Cleanup:
  blackboard: {"action": "delete", "key": "result_db"}
  blackboard: {"action": "delete", "key": "result_fe"}
  blackboard: {"action": "delete", "key": "result_doc"}
```

---

### 5. Adversarial Debate

**Goal**: Pro and con agents debate prior to judge adjudication, suitable for high-risk decisions.

```
Step 1 — Proponent Argument:
  subagent: {"persona": "debater", "goal": "[PRO] Argue for microservice architecture, write to blackboard key=argument_pro", "max_steps": 8}

Step 2 — Opponent Rebuttal:
  subagent: {"persona": "debater", "goal": "[CON] Argue for monolithic architecture rebutting argument_pro on blackboard, write to blackboard key=argument_con", "max_steps": 8}

Step 3 — Adjudication:
  subagent: {"persona": "judge", "goal": "Evaluate argument_pro and argument_con, render final decision with clear rationale", "max_steps": 6}
```

---

### 6. Consensus Voting

**Goal**: Multiple independent decisions voted on by agents, suitable for collective intelligence tasks.

```
Step 1 — Independent Voting (Parallel):
  subagent: {"goal": "Evaluate code quality (1-10) with rationale, write to blackboard key=vote_1", "async_mode": true, "name": "voter_1", "max_steps": 5}
  subagent: {"goal": "Evaluate code quality (1-10) with rationale, write to blackboard key=vote_2", "async_mode": true, "name": "voter_2", "max_steps": 5}
  subagent: {"goal": "Evaluate code quality (1-10) with rationale, write to blackboard key=vote_3", "async_mode": true, "name": "voter_3", "max_steps": 5}

Step 2 — Aggregate Votes:
  blackboard: {"action": "list", "key": "*"}
  Orchestrator reads vote_1, vote_2, vote_3 and computes average or majority consensus.
```

---

## Advanced Features

### Hierarchical Observability
Logs are organized under `.aura-workspace/state/subagents/{parent_id}/{child_id}`.
- **Trajectory Export**: Synchronous Subagents automatically export `trajectory.txt` for tracing reasoning.

### Re-Orchestration
If a `subagent` returns `status: "failed"`, the orchestrator dispatches a diagnostician:
```
subagent: {"persona": "diagnostician", "goal": "Analyze the following failure report and suggest remediation: {error_details}", "max_steps": 6}
```

### Concurrency Control (Blackboard Locking)
Acquire locks when multiple subagents attempt to mutate shared keys:
```
blackboard: {"action": "lock", "key": "shared_resource", "timeout": 5}
// ... execute mutation ...
blackboard: {"action": "release", "key": "shared_resource"}
```

---

## Best Practices

1. **Budget Guard**: Always explicitly set `max_steps` (5-15 recommended) and `timeout` to prevent infinite loops.
2. **Deliverables First**: Child processes must write deliverables to files or blackboard before exiting.
3. **Context Cleanup**: Delete expired blackboard keys after synthesis using `{"action": "delete", "key": "..."}`.
4. **Atomic Goals**: Keep subagent goals specific and focused to minimize hallucination.
5. **`[SCOPE]` Hints**: Use `[SCOPE: path/to/file]` in goals to direct subagent focus.
