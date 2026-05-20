# Kernel & Execution Engine

## Scope & Paths

This document covers the **Aura Kernel**, the core Ruby runtime that orchestrates execution, enforces security, and manages tool protocols.
- **Framework Code**: `lib/aura/kernel/` (ExecutionEngine, Runner, ToolValidator).
- **Project Context**: The Kernel runs inside a generated Agent project root.

## Core Components

### 1. The Runner (`Aura::Kernel::Runner`)
The entry point for the "Brain". It runs a REPL-like loop:
1. **Observe**: Calls `Context::Manager` to assemble prompt.
2. **Plan**: Calls LLM to decide next action.
3. **Execute**: Calls `ExecutionEngine` to run tools.
4. **Metabolize**: Triggers state pruning if context is full.

### 2. Execution Engine (`Aura::Kernel::ExecutionEngine`)
Handles the low-level execution of tools.
- **Routing**: Dispatches `mcp.*` tools to MCP Manager, `lsp_*` to LSP, and local tools to `Open3`.
- **Runtime Resolution**: Maps `runtime: python3` in manifest to actual paths via `config.yml`.
- **Output Parsing**: Captures stdout/stderr. Expects JSON output from tools.

### 3. Tool Validator (`Aura::Kernel::ToolValidator`)
Enforces the "Evolution Loop" quality gate.
- **Checks**: Presence of `manifest.json`, `logic.py`, and `test.py` (unless `skip_test: true`).
- **Verification**: Runs `test.py` before a tool can be `[ACTIVE]`.
- **Caching**: Results are cached in `state/aura.db` to avoid re-running tests.

---

## Security & Sandbox Model

Security is enforced at the **Execution Layer**.

### Path Isolation Strategy
Aura OS is designed for root-level isolation. Tools should not access files outside the project root.

**Mechanism**:
1. **Kernel Injection**: When `security.strict_path_isolation: true` (in `config.yml`), the Kernel injects:
   - `strict_mode: true`
   - `context_permissions`: List of allowed path prefixes (default: `["./knowledge", "./tools", "AURA_README.md"]`).
   - `forbidden_extensions`: e.g. `[".env", ".key"]`.
   - `read_only_directories`: e.g. `["system_tools"]`.
2. **Tool Enforcement**: Built-in tools (`read_file`, `write_file`) check these args and reject unauthorized paths.
3. **Manifest Allow-List**: Tools can request extra paths via `permissions.allow_paths` in `manifest.json`.

### Sandboxing (Subprocesses)
- **Local (Default)**: Tools run as subprocesses. `Open3.capture3` isolates memory but shares the filesystem (subject to OS permissions).
- **Docker (Roadmap)**: Configuration exists (`security.sandbox.provider: docker`) to wrap execution in containers.

---

## Tool Protocol Specification

### Directory Structure
```text
tools/[tool_name]/
├── logic.py         # Entry point
├── manifest.json    # Metadata & Permissions
├── test.py          # Verification script
└── logic.py.hint    # (Optional) Usage tips
```

### Manifest (`manifest.json`)
```json
{
  "name": "my_tool",
  "description": "A brief description of what the tool does.",
  "runtime": "python3",
  "entry": "logic.py",
  "test": "test.py",
  "skip_test": false,
  "verification": { "require_test": true },
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
- `allow_paths`: List of additional allowed path prefixes (relative to project root).
- `shell`: `boolean` - Allow shell command execution.
- `self_edit`: `boolean` - Allow tool to modify its own source.

#### Input Schema
Aura uses a strict subset of JSON Schema:
- Top-level `type` must be `"object"`.
- `properties` defines arguments.
- `required` lists mandatory fields.

### Execution Contract
- **Input**: `sys.argv[1]` is a JSON string of arguments.
- **Output**: STDOUT must be a single JSON object.
  - Success: `{"status": "ok", "content": "..."}`
  - Failure: `{"status": "failed", "error": "..."}`

---

## Tool Timeout System

To prevent hanging subprocesses or infinite loops in tool executions from consuming system resources indefinitely, Aura OS enforces a multi-tier tool timeout system.

### 1. Global Configurations (`config.yml`)
- `default_timeout_seconds` (default: 300 / 5 minutes): The base timeout applied to any tool that does not declare a custom limit in its manifest.
- `max_timeout_seconds` (default: 1200 / 20 minutes): The hard upper boundary. No tool execution can exceed this limit under any circumstances.
- `agent_can_modify_timeout` (default: true): A global flag permitting or denying the agent the ability to pass custom overrides during execution.

### 2. Manifest Specifications (`manifest.json`)
- `timeout` (optional): Overrides the system's `default_timeout_seconds` specifically for this tool.
- `agent_can_modify_timeout` (optional): Overrides the system's `agent_can_modify_timeout` permission for this specific tool.

### 3. Execution Overrides
When calling a tool, the agent can optionally specify a custom timeout in the arguments by passing:
- `timeout_seconds` (integer/float)
- `timeout` (integer/float)

The final timeout is resolved as:
1. **Agent Override**: Used if `agent_can_modify_timeout` is true.
2. **Manifest Timeout**: Used if defined in the manifest.
3. **Default Timeout**: System default fallback (300).

Finally, the resolved timeout is clamped to be no greater than the system's `max_timeout_seconds`.

### 4. Process Isolation & Resource Cleanup
- Tools run as subprocesses inside a wrapper (`capture3_with_timeout`).
- Upon timeout detection, the Kernel terminates the child process by sending a `TERM` signal, falling back to a `KILL` signal if it does not exit within 2 seconds.
- All background threads used to manage standard input/output pipes are reaped to prevent resource leaks.
