# Kernel & Execution Engine

The Aura Kernel is the core TypeScript runtime that orchestrates execution, enforces security, and manages tool protocols.

**Framework Code**: `src/core/kernel/` (agentLoop, executionEngine, runner, ralphLoop, processRuntime, workspaceRuntime, shadowBackup)  
**Project Context**: The Kernel runs inside a generated Agent project root

---

## Core Components

### 1. The Agent Loop (`AgentLoop` in `src/core/kernel/agentLoop.ts`)

The unified central orchestrator for the agent's goal execution.

**Responsibilities:**
- **Loop Orchestration**: Runs a state-machine loop to achieve a goal
- **Planner Execution**: Calls the LLM planner, handles plain text or raw string responses, extracting the final answer directly upon natural stops (finish_reason: 'stop') rather than wrapping them as tool calls.
- **Robust Error Tolerance**: Retries malformed JSON responses up to 5 times (configurable via `system.max_format_errors`) and handles blocked tools (up to 3 times, configurable via `system.max_tool_errors`) with feedback injections so the agent can self-correct
- **Exception Boundary**: Catches and standardizes execution errors into standard JavaScript Error instances, and wraps tool execution subprocess crashes into structured `ToolResult` failure objects to prevent the entire runner daemon from terminating.

**Usage**: AgentLoop wraps Runner for complex goal-based execution. For simpler interactions, Runner can be used directly.

### 2. The Ralph Loop (`RalphLoop` in `src/core/kernel/ralphLoop.ts`)

A meta-loop orchestrator that wraps and executes standard `AgentLoop` instances in a verification-driven, stateless feedback cycle.

**Responsibilities:**
- **Session DB Rotation**: Generates fresh session names per step and hot-swaps memory SQLite databases via `Runner.reconnectSession()` to achieve database history amnesia.
- **Planning Hook Injection**: Registers a `'before_planning'` hook on the `Runner` to persistently wrap standard payload observations, ensuring that the `RALPH_PROTOCOL_PROMPT` and verification error recaps are never forgotten during multi-step executions.
  - **Dual Verification**: Supports physical command suite runs (succeeding on exit code `0`) or Critic LLM auditing:
    - **Light Critic Mode**: Directly calls the LLM in a single-turn verification to evaluate the implementation (using `CRITIC_PROTOCOL_PROMPT`). No tool access or global workspace context is provided.
    - **Heavy Critic Mode**: Runs a full Critic `AgentLoop` (using `CRITIC_HEAVY_PROTOCOL_PROMPT`) with access to all native tools and global workspace context/awareness.
    - Configured via CLI `--critic-mode` (`light` or `heavy`) or `critic_mode` in `config.yml`.
  - **Critique Persistence**: Persists auditing feedback reports under `.aura-workspace/state/critic_audit_[run_id]_step_[step].md` inside the environment/workspace path.
  - **Result Artifact**: Persists structured Ralph run results under `.aura-workspace/state/ralph/runs/<run_id>/result.json`. The artifact includes `status`, `run_id`, `iterations`, `final`, `result_path`, and a `verification` object containing physical verifier or critic-audit details. Physical verifier stdout/stderr are also persisted under the same run directory.

**Ralph Loop Prompts & Workspace Overrides:**
The Ralph Loop swaps standard system prompts with specialized, loop-compliant instructions resolved through the `PromptRegistry` (`src/core/llm/prompts/registry.ts`):

- **Ralph Developer Prompt (`ralph_developer`)**
  - **Base Protocol (`RALPH_PROTOCOL_PROMPT`)**: Tells the LLM that there is no session history, instructions are read from files, troubleshooting must be persistent, and outputs must strictly be a single valid tool-calling JSON block (or raw plain text when completing).
  - **Custom Override**: Scans the workspace for `prompts/ralph/ralph_system.md` (or `.aura-workspace/prompts/ralph/ralph_system.md` / `prompts/ralph_system.md` / `.aura-workspace/prompts/ralph_system.md` / `skills/ralph_system.md` / `.aura-workspace/skills/ralph_system.md`).
  - **Fallback**: Falls back to `DEFAULT_RALPH_USER_DIRECTIVES` (general coding quality guidelines).

- **Ralph Critic Prompt (`ralph_critic`)**
  - **Base Protocol**:
    - **Light Mode (`CRITIC_PROTOCOL_PROMPT`)**: Instructs a secondary critic LLM to audit changes, set `"completed": true/false`, and provide a structured JSON containing a `critique` and actionable `advice`.
    - **Heavy Mode (`CRITIC_HEAVY_PROTOCOL_PROMPT`)**: Instructs the critic to execute tools as needed in a Critic Agent Loop and output ONLY a final audit JSON block upon completion.
  - **Custom Override**: Scans the workspace for `prompts/ralph/critic_rules.md` (or `.aura-workspace/prompts/ralph/critic_rules.md` / `prompts/critic_rules.md` / `.aura-workspace/prompts/critic_rules.md` / `skills/critic_rules.md` / `.aura-workspace/skills/critic_rules.md`).
  - **Fallback**: Falls back to `DEFAULT_CRITIC_AUDIT_RULES` (general code quality criteria checklist).

**Ralph Result Shape:**

```json
{
  "status": "completed",
  "run_id": "20260617...",
  "goal": "Fix failing tests",
  "iterations": 1,
  "started_at": "2026-06-17T00:00:00.000Z",
  "completed_at": "2026-06-17T00:00:05.000Z",
  "final": "Task completed successfully.",
  "result_path": ".aura-workspace/state/ralph/runs/20260617.../result.json",
  "verification": {
    "mode": "physical",
    "passed": true,
    "command": "npm test",
    "exit_code": 0,
    "timed_out": false,
    "stdout_tail": "...",
    "stderr_tail": "...",
    "output_tail": "..."
  }
}
```

Downstream tools can use `result_path` as a stable proof that a Ralph verifier or critic completed successfully.

### 3. The Runner (`Runner` in `src/core/kernel/runner.ts`)

Acts as the context adapter and execution coordinator.

**Responsibilities:**
- **Observe**: Assembles prompt context from state/database and registers current environment metadata
- **Session Swapping**: Implements `reconnectSession(sessionName)` to swap database session references on the fly.
- **State Recording**: Records state events (user inputs, plans, completions) and manages job states in the database
- **Execution Hook Coordinator**: Dispatches pre-execution and post-execution hooks (e.g. dangerous tool checks)
- **Event Emission**: Extends Node.js `EventEmitter` for broadcasting tool execution events

**Lifecycle**: Observe → Plan → Execute → (Learn)

### 4. The Event Bus / Hooks (`EventEmitter` in `events` module)

An event-driven publisher-subscriber structure that decouples core agent execution from user interfaces (CLI, Web client).

**Implementation**: `Runner` extends Node's built-in `EventEmitter` class.

**Events:**
- `'plan_stream_start'` - LLM plan generation starts
- `'plan_event'` - Token stream from LLM
- `'thought'` - Agent thinking
- `'tool_start'` - Tool execution begins
- `'tool_result'` - Tool execution completes
- `'final_answer'` - Mission complete
- `'loop_aborted'` - Loop terminated early

**Note**: A separate `eventBus.ts` (`src/core/memory/eventBus.ts`) exists for global event bus coordination, while the `Runner` uses the `EventEmitter` inheritance pattern for local event subscription.

### 5. Execution Engine (`ExecutionEngine` in `src/core/kernel/executionEngine.ts`)

Handles the low-level execution of tools.

**Responsibilities:**
- **Routing**: Dispatches `mcp.*` tools to MCP Manager, `lsp_*` to LSP, and local tools to the subprocess manager (`execa`)
- **Runtime Resolution**: Maps `runtime: python3` in manifest to actual paths via `config.yml`
- **Output Parsing**: Captures stdout/stderr. Expects JSON output from tools
- **Background Processes**: Starts detached or PTY-backed background tool processes, records metadata under `state/commands`, and exposes interactive stdin through `send_process_input`.

### 6. Runtime APIs (`ProcessRuntime` and `WorkspaceRuntime`)

Runtime APIs live in `src/core/kernel/` so daemon, CLI, and future UI surfaces share the same behavior and safety boundaries.

**ProcessRuntime (`src/core/kernel/processRuntime.ts`):**
- Lists tracked background processes from `state/commands`.
- Reads and tails stdout/stderr logs.
- Kills tracked processes and updates metadata.
- Sends input to PTY-backed background processes through the active `ExecutionEngine`.

**WorkspaceRuntime (`src/core/kernel/workspaceRuntime.ts`):**
- Reads and writes workspace files for daemon/UI RPCs.
- Builds the workspace file tree using the same ignored-directory rules as the kernel runner.
- Rejects restricted paths such as `.git`, `.aura`, `.aura-workspace`, and `node_modules`.

Daemon handlers should delegate to these runtime APIs and only handle IPC parameter validation, result serialization, notifications, and socket lifecycle.


## Security & Sandbox Model

Security is enforced at the **Execution Layer**.

### Path Isolation Strategy

Aura OS is designed for root-level isolation. Tools should not access files outside the project root.

**Mechanism:**

1. **Kernel Injection**: When `security.strict_path_isolation: true` (in `config.yml`), the Kernel injects:
   - `strict_mode: true`
   - `context_permissions`: List of allowed path prefixes (default: `[".", "./knowledge", "./tools", "AURA_README.md"]`). The `"."` grants access to the entire workspace and all subdirectories
   - `forbidden_extensions`: e.g. `[".env", ".key"]`
   - `read_only_directories`: e.g. `["system_tools"]`

2. **Tool Enforcement**: Built-in tools (`read_file`, `write_file`) check these args and reject unauthorized paths

3. **Manifest Allow-List**: Tools can request extra paths via `permissions.allow_paths` in `manifest.json`

### Sandboxing (Subprocesses)

**Local (Default)**: Tools run as subprocesses. `execa` isolates memory but shares the filesystem (subject to OS permissions).

**Docker (Roadmap)**: Configuration exists (`security.sandbox.provider: docker`) to wrap execution in containers.

---

## Tool Protocol Specification

### Directory Structure

```
tools/[tool_name]/
├── logic.py         # Entry point
├── manifest.json    # Metadata & Permissions
└── logic.py.hint    # (Optional) Usage tips
```

### manifest.json

```json
{
  "name": "my_tool",
  "description": "A brief description of what the tool does.",
  "runtime": "python3",
  "entry": "logic.py",
  "auto_load": true,
  "input_schema": {
    "type": "object",
    "properties": {
      "file_path": { "type": "string", "description": "Path to file" }
    },
    "required": ["file_path"]
  },
  "permissions": {
    "file_system": "read-write",
    "allow_paths": ["./data"],
    "shell": false,
    "self_edit": false
  }
}
```

#### Permission Conventions

- `file_system`: `"read-only" | "read-write" | "full-access"`
- `allow_paths`: List of additional allowed path prefixes (relative to project root)
- `shell`: `boolean` - Allow shell command execution
- `self_edit`: `boolean` - Allow tool to modify its own source

#### Input Schema

Aura uses a strict subset of JSON Schema:
- Top-level `type` must be `"object"`
- `properties` defines arguments
- `required` lists mandatory fields

### Execution Contract

**Input**: The JSON string of arguments is written directly to the child process's **STDIN**. (Note: Standard python templates also support reading from `sys.argv[1]` as a fallback, but the primary method is STDIN).

**Output**: STDOUT must be a single JSON object

```json
// Success
{"status": "ok", "content": "..."}

// Failure
{"status": "failed", "error": "..."}
```

---

## Tool Timeout System

To prevent hanging subprocesses or infinite loops, Aura OS enforces a multi-tier tool timeout system.

### 1. Global Configurations (`config.yml`)

- `default_timeout_seconds` (default: 300 / 5 minutes): Base timeout for tools without custom manifest limit
- `max_timeout_seconds` (default: 1200 / 20 minutes): Hard upper boundary. No tool can exceed this
- `agent_can_modify_timeout` (default: true): Permit/deny agent ability to pass custom overrides

### 2. Manifest Specifications (`manifest.json`)

- `timeout` (optional): Overrides system's `default_timeout_seconds` for this tool
- `agent_can_modify_timeout` (optional): Overrides system's `agent_can_modify_timeout` for this tool

### 3. Execution Overrides

When calling a tool, the agent can specify a custom timeout in arguments:
- `timeout_seconds` (integer/float)
- `timeout` (integer/float)

**Resolution Order:**
1. **Agent Override**: Used if `agent_can_modify_timeout` is true
2. **Manifest Timeout**: Used if defined in manifest
3. **Default Timeout**: System default fallback (300)

Final timeout is clamped to `max_timeout_seconds`.

### 4. Process Isolation & Resource Cleanup

- Tools run as subprocesses using `execa` with a timeout parameter
- Upon timeout, Kernel terminates child process with `SIGTERM` signal, falling back to `SIGKILL` if it doesn't exit immediately
- All child process stdin/stdout streams are closed and cleaned up to prevent resource leaks

---

## Code References

- **AgentLoop**: `src/core/kernel/agentLoop.ts`
- **Runner**: `src/core/kernel/runner.ts`
- **ExecutionEngine**: `src/core/kernel/executionEngine.ts`
- **RalphLoop**: `src/core/kernel/ralphLoop.ts`
- **EventBus**: `src/core/memory/eventBus.ts`

---

## See Also

- [Architecture Overview](../explanation/architecture.md) - System-wide architecture
- [Context & State](../explanation/context-and-state.md) - State management
- [Extend with Skills, Tools, and Garden](../how-to/extend-with-skills-and-tools.md) - User guide for tools, skills, and Garden playbooks
