# Aura Project Guide

## Debugging Quickstart
- Print active context:
  - `aura context .`
- Inspect tools:
  - Structured: `aura tools inspect <tool>`
  - Formatted JSON: `aura tools inspect <tool> --pretty`
  - Human readable: `aura tools inspect <tool> --human`
- Run single kernel turn:
  - JSON output:
    - `aura kernel once . -c '{"tool":"read_file","args":{"file_path":"config/config.yml","context_permissions":["."]}}'`
  - Human readable:
    - `aura kernel once . -H -n 8 -c '{"tool":"read_file","args":{"file_path":"config/config.yml","context_permissions":["."]}}'`

## LLM Integration (OpenRouter)
- Configure provider in `config/config.yml` → `llm.provider: "openrouter"`, `llm.model: "openai/gpt-4o-mini"` (or preferred model)
- Create `.env` in project root:
  - `OPENROUTER_API_KEY=sk-...` (Do not commit to version control)
- Run planning turn:
  - `aura kernel plan . -H -n 8` (Sends context and goal to LLM, outputs next tool call)
- Autonomous loop execution:
  - `aura kernel loop . -g "Your goal" -m 10` (Stops when max steps reached or final answer produced)

## Workspace & Memory
- Workspace root defaults to current working directory (`cwd`).
- Isolation enforced via `security.strict_path_isolation` and sandbox options.
- Custom directive files: `AGENTS.md`, `SOUL.md`, `USER.md`, `TOOLS.md`, `IDENTITY.md`, `MEMORY.md`
- Optional daily memory: `memory/YYYY-MM-DD.md` (Loads most recent two days automatically if present).

## Frequently Asked Questions
- `Permission Denied`: Add `args.context_permissions` to tool calls or grant permissions in `manifest.json`.
- `Context Window Limit`: Adjust `state_management.max_state_chars` in `config/config.yml` or trigger memory metabolism.
- `Extending Capabilities`: Edit `tools/mcp/config.yml` to register external MCP servers (Stdio & SSE supported).

## Version Control & Security
- Keep workspace tracked in a private Git repository.
- Avoid committing `.env`, API keys, certificates, or credentials.

## State Files & Telemetry
- SQLite Database: `.aura-workspace/state/sessions/default.db` (Use `aura session` to switch active session DB).
- View recent events: `sqlite3 .aura-workspace/state/sessions/default.db "SELECT id, phase, tool, payload FROM events ORDER BY id DESC LIMIT 10;"`
- View recent summaries: `sqlite3 .aura-workspace/state/sessions/default.db "SELECT id, content FROM summaries ORDER BY id DESC LIMIT 5;"`
