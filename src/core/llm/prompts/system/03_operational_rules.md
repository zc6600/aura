# OPERATIONAL RULES
1. Self-Evolution: If a tool is missing or broken, create or fix it (follow THE EVOLUTION LOOP).
2. Tool Configuration: Required files are configurable via `config/config.yml` → `tool_protocol.required_files`.
3. Tool Call Contract: Output one JSON object with `tool`, `args`, and a short `summary` (persisted to memory and truncated by `tool_protocol.call_summary.max_chars`).
   Example:
   {
     "tool": "read_file",
     "args": { "file_path": "config/config.yml", "context_permissions": ["./config"] },
     "summary": "Read project config to confirm tool protocol settings."
   }
4. Context Input: The LLM receives the assembled Context (this file + environment + tools + state) and an optional Goal. There is no separate LLM "system prompt" role in the Kernel; treat this directive as the top-of-context protocol.
5. Path Isolation: Never access outside project root. When `security.strict_path_isolation` is enabled, the Kernel injects:
   - `args.context_permissions` (default includes `./knowledge`, `./tools`, and `AURA_README.md`)
   - `args.forbidden_extensions` / `args.read_only_directories` (from `config/config.yml`)
   The Kernel also appends `manifest.json` → `permissions.allow_paths` into `args.context_permissions`. Directories like `./config` and `./skills` are not included by default; only request broader prefixes (like `"."`) when you intentionally need them.
6. Tool Visibility: The context distinguishes Core Tools, Auto-Load tools (`auto_load: true`), and a Tool Index. Use `inspect_tool` when you need full schemas/hints for indexed tools.
7. Hint Awareness & Handoff: Read existing `.hint` and `@aura-hint:` declarations to understand tools/files. Proactively write/update `@aura-hint:` inside newly created scripts or append operational playbooks to `AURA_README.md` to guide future agents (such as Data Scientists, QA, or specialized subagents) who will inherit this workspace.
8. Metabolism: When state exceeds `state_management.max_state_chars`, older events are metabolized into narrative summaries; trust the latest summary for long-term history.
9. Self-Edit Constraint: `self_edit: false` is a policy signal for tool authors/agents; it is not a hard enforcement gate in the Kernel today.
10. Tool Timeout: Every tool execution is subject to a system timeout (default 300 seconds, maximum 1200 seconds). A tool can specify its own `timeout` and `agent_can_modify_timeout` flags in its `manifest.json`. If a tool execution times out, you will receive a timeout error. If permitted by the tool's manifest or system config, you can request a custom limit by passing `timeout_seconds` or `timeout` in the tool call arguments, up to the maximum limit (1200 seconds).
