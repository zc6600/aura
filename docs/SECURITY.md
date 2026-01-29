# Security & Sandbox Model

## Path Isolation

Aura OS enforces strict root-level isolation. Any attempt to use `../` to access files outside the workspace root will be intercepted by the Ruby Kernel.

## Permission Tiers

- **System Tools**: (e.g., `read_file`) Defined with `self_edit: false`. The Agent cannot modify these core functions.
- **Agent Tools**: Created by the Agent with `self_edit: true`. These can be iteratively improved.
- **Read-Only Knowledge**: Files in the `knowledge/` directory are protected from modification unless explicit write permissions are granted.

## Execution Sandbox

Each tool execution is a spawned subprocess. Future versions will support Docker-based isolation for untrusted code execution.

---

# 🌌 Deep Design Doc (Part III: Execution Engine & Security Sandbox)

## 1. Interpreter Routing

Route by `manifest.json.runtime` or file extension:

- `.py` → use `python3` path from `config.yml`
- `.rb` → use `ruby` path from `config.yml`
- `.sh` → execute via `bash`/`sh`

## 2. Self-Contained Environments

Dependency installation flow:

1. Parse: read `dependencies` when `manifest.json` changes.
2. Isolation:
   - Python: project-level `.venv`, then `pip install`
   - Ruby: if `Gemfile` exists, run `bundle install`
3. Cache: record installed packages to avoid repeated checks.

## 3. Security & Permissions

- `fs_access`: `read-only` / `read-write` / `restricted` (specific subpaths like `/tmp`)
- `network_access`: allow or deny HTTP requests
- `self_edit`: when `false`, system tools cannot self-modify

## 4. Path Sanitization

- Normalize to absolute paths and enforce `workspace_root` prefix.
- Block traversal attempts like `../../etc/passwd`.

## 5. Feedback Pipe

Use `Open3.popen3` to start and monitor subprocesses:

- STDOUT: normal tool output returned to the agent
- STDERR: error output; structure before feedback
- Exit Status: process termination code

Format feedback with tool name, exit code, traceback focus lines, and actionable hints.

## Communication Protocol

JSON-over-CLI:

- Input: pass a JSON string as a CLI argument (e.g., `python logic.py '{"path":"data.csv"}'`)
- Output: print JSON to STDOUT
- Logs: send human-readable prints to STDERR

## Permission Delegation & Runtime Enforcement

To ensure defense-in-depth, Aura OS enforces permissions at both the Kernel and tool layers:

- Kernel reads `config.yml` and `manifest.json` to determine allowed paths and capabilities.
- Kernel injects `context_permissions` (and optionally `forbidden_extensions`, `read_only_directories`) into tool inputs.
- Atomic tools (`read_file`, `write_file`) perform final path normalization and authorization checks:
  - Reject path traversal beyond workspace root (`../` outside root).
  - Validate target path falls under one of the allowed directories.
  - `write_file` additionally blocks forbidden extensions and read-only directories.

This approach prevents bypasses via custom scripts and guarantees IO safety at the lowest layer.
## Developer Priorities (Part III)

1. Runtime wrapper based on `config` with interpreter routing.
2. Dependency manager for Python venv/pip and Ruby bundler.
3. Sandbox guard functions for path checks and permissions.
