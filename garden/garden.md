---
name: aura-garden
description: Playbook for dynamic garden engineering and task-specific scaffolding. Use when a task requires organizing custom rules, active hints, workspace-level constraints, or routing to domain-specific sub-gardens.
requires:
  - write_file
  - read_file
  - run_command
  - subagent
  - blackboard
---

# Aura Garden: Playbook Router

This Garden playbook provides a routing and orchestration workflow. It instructs the Meta-Agent on how to categorize a complex task and assemble the right project-level context, including domain sub-playbooks, prompts, anchors, hints, tools, and skills.

A cornerstone of executing complex tasks on Aura OS is the clean separation of **engineering** (establishing a robust, verified, and reproducible foundation such as data loaders, validation strategies, or resource constraints) and **science** (iterative model tuning, parameter sweeps, or code optimizations). By first establishing and freezing a correct engineering setup, the agent can execute rapid, isolated scientific experiments in specific areas without creating "moving targets" that degrade context or stability.

## Aura System & Garden Scaffolding Overview

Aura OS is an AI-native operating system that treats the filesystem as an agent's workspace and extended memory. Rather than relying solely on linear prompt histories, it uses structured workspace files, custom tools, and metadata hooks to guide agent reasoning, persistence, and execution. All execution states (events, variables, plans, summaries) are persisted in a session-specific SQLite database under `.aura-workspace/state/sessions/<session_name>.db` (or `.aura/state/...` fallback).

### Built-in Scaffolding for Agent-Gardening

Aura provides several native mechanisms to construct dynamic execution constraints, guide agent reasoning, and set up task-specific scaffolding:

1. **Modular Prompts & Persona Customization (提示词与角色定制)**
    - Modular prompt files are loaded from a priority-ordered set of candidate paths. The recommended location for new workspaces is `prompts/system/<FILE>` (e.g. `prompts/system/SOUL.md`), which mirrors the generated template structure. The `.aura-workspace/prompts/system/<FILE>` path (or `.aura/prompts/system/<FILE>` fallback) is also supported as an alternative.
   - Supported named files: `SOUL.md` (persona & tone boundaries), `AGENTS.md` (operating instructions & safety rules), `USER.md` (user profile preferences), `TOOLS.md` (tool usage tips), `IDENTITY.md` (agent name & self-concept), `MEMORY.md` (curated long-term memory).

2. **Task Nodes & Anchors (任务锚点图)**
   - **`anchors/` Directory**: JSON/YAML files containing step-by-step task nodes with trigger conditions (`call_when`). Each file must include an `id` field and a `call_when` array. Only the first element of `call_when` is shown in the injected context label.
   - Combined with the current high-level `plan` stored in SQLite, they form a stateful progress checklist injected into the agent's context to prevent loop drift.
   - **Anchor format example**:
     ```json
     { "id": "01_baseline_verified", "call_when": ["Baseline benchmark has been run and metrics recorded in task.md"] }
     ```

 3. **Workspace Hints & Local Guidance (局部提示与双通道引导)**
   - **`@aura-hint:` comment tags**: Scanned in text files (`.py`, `.rb`, `.sh`, `.md`, `.txt`) up to depth 5 in the workspace (skipping hidden directories like `.git`, and common output dirs like `node_modules`, `vendor`, `state`, `build`). Any comment matching `@aura-hint:` in the **first `hints.max_scan_lines` lines** of a file (default: **2000**) is extracted and injected as an active, top-level constraint. **Each hint is capped at `hints.max_hint_chars` characters (default: 1000)**; longer hints are truncated.
   - **Companion `.hint` files**: For files inside `knowledge/`, create a companion `<filename>.hint` file (e.g. `knowledge/paper.pdf.hint`) listing key context. The hint content is appended in the compiled index (e.g. `- paper.pdf (Context: ...)`), allowing the agent to understand document contents without loading large files. **Content is capped at `hints.max_file_chars` characters (default: 10,000)**. For files outside `knowledge/` (e.g. `lib/core/parser.rb.hint`), creating a companion `.hint` file allows adding hints for large or code files without cluttering the source code with comment tags. The system scans the entire workspace for these `.hint` files and loads their entire contents as top-level active constraints, subject to the standard `hints.max_hint_chars` limit (default: 1000).

4. **Subagent Spawning & Multi-Agent Collaboration (子智能体派生与多智能体协作)**
   - **`subagent` Tool**: Spawns independent subagent processes with isolated state, targeted goals, and specific personas (e.g. `architect`, `reviewer`, `coder` instructions loaded from `state/personas/{persona}.json`). Supports **synchronous** and **asynchronous** (`async_mode: true`) modes; async mode returns a `job_id` for polling status later.
   - **Persona format**: Create `state/personas/<name>.json` with an `instructions` key. Example:
     ```json
     { "instructions": "You are a strict code auditor. Focus only on real bugs and security issues. Do not report style preferences." }
     ```
   - **Process & Depth Isolation**: Prevents execution overflow using environment-variable depth tracking (`AURA_SUBAGENT_DEPTH`). The default max recursion depth is 3 (configurable via `AURA_SUBAGENT_MAX_DEPTH`).
   - **Shared Blackboard Bus (共享数据黑板)**: A key-value bus via the `blackboard` tool (actions: `read`, `write`, `lock`, `release`, `list`, `delete`), allowing parallel subagents to pass structured data without polluting the main agent's prompt context. Keys are stored in `state/bus/`. ⚠️ **Session isolation**: blackboard keys are namespaced by the active session name (`AURA_SESSION_NAME`). Ensure all agents share the same session when reading/writing shared keys.
   - **Execution & Trace Logs**: Exports execution trajectories to `state/subagents/{parent_id}/{child_id}/trajectory.txt` for tracing and auditing.

5. **Autonomous Loop Controls (Ralph Loop 双智能体循环控制)**
   - **`ralph` Loop Mode**: Starts a stateful, iterative developer-critic loop running up to `max_steps`. Each step runs in an isolated SQLite session, dynamically swapping database connections to prevent context and memory bloat.
   - **Verification Modes**:
     - *Physical command*: Set `ralph.verify_command` in `.aura-workspace/config/config.yml` (or `.aura/config/config.yml` fallback) to a shell command (e.g. `bundle exec rspec`). The loop passes only when this command exits with code 0.
     - *Critic LLM — `light` mode* (default): After each developer step, a single LLM call audits the git diff and outputs a `{"completed": true/false, "critique": "...", "advice": "..."}` JSON verdict.
     - *Critic LLM — `heavy` mode*: The critic runs as a full AgentLoop with access to tools, enabling deeper multi-step inspection. Set `ralph.critic_mode: heavy` in `.aura-workspace/config/config.yml` (or `.aura/config/config.yml` fallback).
     - *Audit Trail*: Each critic evaluation writes a `state/critic_audit_<run_id>_step_<n>.md` file with the full critique and advice, allowing post-hoc review of every iteration decision.
     - *Ralph Prompt Customizations*: Overrides default behaviors by creating `prompts/ralph/ralph_system.md` (developer directives) and `prompts/ralph/critic_rules.md` (critic checklist rules) in the workspace.
     - *When to use Ralph Loop vs. Direct Execution*:
       - **Use Ralph Loop** when the task is highly iterative, algorithmic, or error-prone (e.g. fixing test failures, optimizing performance hotspots, refactoring core interfaces) and has a clear, automated test or verification command (e.g. `rake test`, `pytest`, a custom script) to run after every change.
       - **Use Direct Execution** (running directly in the main agent workspace or spawning one-off subagents) when the task is exploratory, documentation-based, requires user feedback, or does not have a reliable programmatic verification script.

6. **Shadow Backups & Git Snapshots (系统快照与变更恢复)**
   - **Shadow Backup**: Background system that records file modifications, additions, and deletions after each tool call to track exact filesystem state transitions.
   - **Git Snapshots**: Auto-commits changes to local git version control upon successful tool runs when `security.git_snapshots` is enabled, establishing recovery points.

## Documentation Map

The framework manual is organized with Diátaxis under `docs/`. Consult the matching section when you need authoritative details:

### `docs/explanation/` — Architecture and Design Rationale
| File | When to Read |
|------|-------------|
| `architecture.md` | Overview of the full Aura OS component graph |
| `configuration-model.md` | How YAML config, `.env`, provider detection, and sessions fit together |
| `context-and-state.md` | How the system prompt is assembled; all context providers |
| `memory-management.md` | SQLite state DB schema, variables, event history, compression |
| `session-architecture.md` | Session isolation model; how Ralph and subagents swap DBs |
| `daemon-architecture.md` | Daemon lifecycle, IPC, and latency design |
| `testing-strategy.md` | Why tests are split into unit, integration, system, and daemon layers |
| `tools-skills-and-mcp.md` | Boundaries between tools, skills, and MCP integrations |
| `workspace-and-template-model.md` | Relationship between workspaces, hidden environments, and global templates |

### `docs/reference/` — Exact Contracts
| File | When to Read |
|------|-------------|
| `cli.md` | Full list of `aura` CLI commands and flags |
| `configuration.md` | Config schema sections, keys, and value types |
| `kernel.md` | Agent loop, execution engine, hooks, and runner internals |
| `integrations.md` | LSP, MCP, and external tool integration points |
| `context-refactoring.md` | Context-provider refactoring checklist and implementation details |
| `testing.md` | Test directories, helpers, commands, and layer selection |

### `docs/how-to/` — Task Workflows
| File | When to Read |
|------|-------------|
| `configure-aura.md` | All `config.yml` keys and their effects |
| `manage-sessions.md` | Session management, naming, and switching |
| `extend-with-skills-and-tools.md` | How skills and tools are discovered, loaded, and validated |
| `work-with-templates-and-updates.md` | End-to-end update and template workflows |
| `test-aura.md` | How to run the test suite; patterns for new tests |
| `maintain-changelog.md` | Conventions for writing changelog entries |

### `docs/tutorials/` — Guided Learning
| File | When to Read |
|------|-------------|
| `getting-started.md` | Initial workspace setup and first run |
| `first-tool.md` | First local tool and skill |
| `first-contribution.md` | First framework contribution |

## When to Use
Use this skill at the beginning of any task that requires setting up dynamic guardrails, workspace constraints, inline annotations, or multi-stage pipelines.

## Steps

### 1. Analyze Task Domain
Examine the user's requirements and goal. Categorize the task into one of the following four macro domains:

*   **Software Quality, Compliance, Linting, or Safety Audits?**
    $\rightarrow$ Read and follow the `garden/software-checking/garden.md` playbook.
*   **Performance Bottleneck, Latency Tuning, Benchmarking, or Micro-Optimizations?**
    $\rightarrow$ Read and follow the `garden/perf-tuning/garden.md` playbook.
*   **Mathematical Modeling, Academic Paper Parsing, Parameter Sweeps, or Simulations?**
    $\rightarrow$ Read and follow the `garden/ai-scientist/garden.md` playbook.
*   **Kaggle Competitions, Machine Learning Model Building, Feature Engineering, or Ensembling?**
    $\rightarrow$ Read and follow the `garden/kaggle/garden.md` playbook.
*   **Anything else (refactoring, documentation, migrations, general engineering)?**
    $\rightarrow$ No dedicated sub-playbook. Apply garden primitives directly: set up `AGENTS.md` guardrails for task-specific rules, create `anchors/` nodes to track multi-stage progress, and use `@aura-hint:` tags or `.hint` files to annotate critical context. Spawn subagents only if the task has clearly parallelizable sub-problems.

### 2. Delegate to Sub-Playbook
- Once the domain is chosen, read the corresponding playbook file under `garden/`.
- Follow its specific instructions to:
  1. Configure modular prompts (`AGENTS.md`, `SOUL.md`) or Ralph directives (`prompts/ralph/ralph_system.md`, `prompts/ralph/critic_rules.md`).
  2. Setup task execution nodes (`anchors/` directory) if stateful multi-stage checklist tracking is needed.
  3. Inject workspace guidance (inline `@aura-hint:` comment tags or `<file>.hint` files).
  4. Evaluate trade-offs: **avoid over-engineering**. Only spawn specialized subagents or blackboard buses if parallel execution or environment isolation is truly required.
  5. Enable automated snapshots (`security.git_snapshots: true`) or physical verification commands for safety and regression testing.

### 3. Initialize Execution
- Log the selected reference playbook path to `task.md`.
- Verify that required tools (`subagent`, `blackboard`) are present in the workspace's `.aura-workspace/tools/` (or `.aura/tools/` fallback) directory before dispatching multi-agent workflows.
- Begin execution under the compiled garden constraints.
- Upon task completion, commit changes manually (`git commit`) or rely on automatic snapshots if `security.git_snapshots: true` is set in `.aura-workspace/config/config.yml` (or `.aura/config/config.yml` fallback).
