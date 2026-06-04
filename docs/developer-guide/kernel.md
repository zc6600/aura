# Kernel & Execution Engine

The Aura Kernel is the core Ruby runtime that orchestrates execution, enforces security, and manages tool protocols.

**Framework Code**: `lib/aura/kernel/` (AgentLoop, EventBus, ExecutionEngine, Runner, ToolValidator)  
**Project Context**: The Kernel runs inside a generated Agent project root

---

## Core Components

### 1. The Agent Loop (`Aura::Kernel::AgentLoop`)

The unified central orchestrator for the agent's goal execution.

**Responsibilities:**
- **Loop Orchestration**: Runs a state-machine loop to achieve a goal
- **Planner Execution**: Calls the LLM planner, handles plain text or raw string responses, wrapping them as synthesized `final` tool calls
- **Robust Error Tolerance**: Retries malformed JSON responses up to 5 times (configurable via `system.max_format_errors`) and handles blocked tools (up to 3 times, configurable via `system.max_tool_errors`) with feedback injections so the agent can self-correct
- **Exception Boundary**: Catches and standardizes execution errors into domain exceptions (`Aura::Errors::*`)

**Usage**: AgentLoop wraps Runner for complex goal-based execution. For simpler interactions, Runner can be used directly.

### 2. The Ralph Loop (`Aura::Kernel::RalphLoop`)

A meta-loop orchestrator that wraps and executes standard `AgentLoop` instances in a verification-driven, stateless feedback cycle.

**Responsibilities:**
- **Session DB Rotation**: Generates fresh session names per step and hot-swaps memory SQLite databases via `Runner#reconnect_session!` to achieve database history amnesia.
- **Planning Hook Injection**: Registers a `:before_planning` hook on the `Runner` to persistently wrap standard payload observations, ensuring that the `RALPH_PROTOCOL_PROMPT` and verification error recaps are never forgotten during multi-step executions.
  - **Dual Verification**: Supports physical command suite runs (succeeding on exit code `0`) or Critic LLM auditing:
    - **Light Critic Mode**: Directly calls the LLM in a single-turn verification to evaluate the implementation (using `CRITIC_PROTOCOL_PROMPT`). No tool access or global workspace context is provided.
    - **Heavy Critic Mode**: Runs a full Critic `AgentLoop` (using `CRITIC_HEAVY_PROTOCOL_PROMPT`) with access to all native tools and global workspace context/awareness.
    - Configured via CLI `--critic-mode` (`light` or `heavy`) or `critic_mode` in `config.yml`.
  - **Critique Persistence**: Persists auditing feedback reports under `state/critic_audit_[run_id]_step_[step].md` inside the environment/workspace path.

**Ralph Loop Prompts & Workspace Overrides:**
The Ralph Loop swaps standard system prompts with specialized, loop-compliant instructions resolved through the `Aura::LLM::Prompts::Registry`:

- **Ralph Developer Prompt (`:ralph_developer`)**
  - **Base Protocol (`RALPH_PROTOCOL_PROMPT`)**: Tells the LLM that there is no session history, instructions are read from files, troubleshooting must be persistent, and outputs must strictly be a single valid tool-calling JSON block (or raw plain text when completing).
  - **Custom Override**: Scans the workspace for `prompts/ralph/ralph_system.md` (or `.aura/prompts/ralph/ralph_system.md` / `prompts/ralph_system.md` / `.aura/prompts/ralph_system.md` / `skills/ralph_system.md` / `.aura/skills/ralph_system.md`).
  - **Fallback**: Falls back to `DEFAULT_RALPH_USER_DIRECTIVES` (general coding quality guidelines).

- **Ralph Critic Prompt (`:ralph_critic`)**
  - **Base Protocol**:
    - **Light Mode (`CRITIC_PROTOCOL_PROMPT`)**: Instructs a secondary critic LLM to audit changes, set `"completed": true/false`, and provide a structured JSON containing a `critique` and actionable `advice`.
    - **Heavy Mode (`CRITIC_HEAVY_PROTOCOL_PROMPT`)**: Instructs the critic to execute tools as needed in a Critic Agent Loop and output ONLY a final audit JSON block upon completion.
  - **Custom Override**: Scans the workspace for `prompts/ralph/critic_rules.md` (or `.aura/prompts/ralph/critic_rules.md` / `prompts/critic_rules.md` / `.aura/prompts/critic_rules.md` / `skills/critic_rules.md` / `.aura/skills/critic_rules.md`).
  - **Fallback**: Falls back to `DEFAULT_CRIC_AUDIT_RULES` (general code quality criteria checklist).

### 3. The Runner (`Aura::Kernel::Runner`)

Acts as the context adapter and execution coordinator.

**Responsibilities:**
- **Observe**: Assembles prompt context from state/database and registers current environment metadata
- **Session Swapping**: Implements `reconnect_session!(session_name)` to swap database session references on the fly.
- **State Recording**: Records state events (user inputs, plans, completions) and manages job states in the database
- **Execution Hook Coordinator**: Dispatches pre-execution and post-execution hooks (e.g. dangerous tool checks)
- **Event Emission**: Includes EventEmitter module for broadcasting tool execution events

**Lifecycle**: Observe → Plan → Execute → (Learn)

### 4. The Event Bus (`Aura::Kernel::EventEmitter`)

An event-driven publisher-subscriber module that decouples core agent execution from user interfaces (CLI, Web client).

**Implementation**: `Runner` includes `EventEmitter` module (from `lib/aura/kernel/event_emitter.rb`)

**Events:**
- `:plan_stream_start` - LLM plan generation starts
- `:plan_event` - Token stream from LLM
- `:thought` - Agent thinking
- `:tool_start` - Tool execution begins
- `:tool_result` - Tool execution completes
- `:final_answer` - Mission complete
- `:loop_aborted` - Loop terminated early

**Note**: A separate `event_bus.rb` file exists but is not currently used by Runner; Runner uses the EventEmitter mixin pattern instead.

### 5. Execution Engine (`Aura::Kernel::ExecutionEngine`)

Handles the low-level execution of tools.

**Responsibilities:**
- **Routing**: Dispatches `mcp.*` tools to MCP Manager, `lsp_*` to LSP, and local tools to `Open3`
- **Runtime Resolution**: Maps `runtime: python3` in manifest to actual paths via `config.yml`
- **Output Parsing**: Captures stdout/stderr. Expects JSON output from tools


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

**Local (Default)**: Tools run as subprocesses. `Open3.capture3` isolates memory but shares the filesystem (subject to OS permissions).

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

**Input**: `sys.argv[1]` is a JSON string of arguments

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

- Tools run as subprocesses inside a wrapper (`capture3_with_timeout`)
- Upon timeout, Kernel terminates child process with `TERM` signal, falling back to `KILL` after 2 seconds
- All background threads for stdin/stdout pipes are reaped to prevent resource leaks

---

## Code References

- **AgentLoop**: `lib/aura/kernel/agent_loop.rb`
- **Runner**: `lib/aura/kernel/runner.rb`
- **ExecutionEngine**: `lib/aura/kernel/execution_engine.rb`
- **EventEmitter**: `lib/aura/kernel/event_emitter.rb`

---

## See Also

- [Architecture Overview](architecture.md) - System-wide architecture
- [Context & State](context-and-state.md) - State management
- [Skills & Tools](../user-guide/skills-and-tools.md) - User guide for tools
