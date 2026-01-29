# Tool Development & Evolution Protocol

## Standard Directory Structure

```text
tools/[tool_name]/
├── logic.py         # Primary execution script
├── manifest.json    # Tool configuration
├── test.py          # Mandatory unit tests
└── logic.py.hint    # (Optional) Natural language tips for the Agent
```

## Manifest Specification

Example `manifest.json`:

```json
{
  "name": "file_reader",
  "runtime": "python3",
  "dependencies": { "pip": ["pandas"] },
  "permissions": {
    "self_edit": false,
    "allow_paths": ["./knowledge"]
  }
}
```

## Runtime & Routing

- The `runtime` field determines interpreter routing and can be overridden by file extension when appropriate.
- Typical mapping: `python3` for `.py`, `ruby` for `.rb`, `bash`/`sh` for `.sh`.
- Runtimes are configured via `config.yml` and may be prefixed by sandbox runners (e.g., Docker).

## The Evolution Loop

- **Creation**: Agent writes `logic.py` and `test.py`.
- **Verification**: Kernel executes `test.py`.
- **Error Feedback**: If `test.py` fails, the Kernel pipes `stderr` (traceback) back to the Agent for self-debugging.
- **Activation**: Tool is marked as Active only upon a successful test exit code (`0`).

## Tool Loading Tiers

Aura OS manages context window efficiency by categorizing tools:

1. **Static/Core**: Always present in prompt (defined in `config.yml` under `tool_protocol.core_tools`).
2. **Auto-Load**: Tools with `"auto_load": true` in `manifest.json` are eagerly loaded.
3. **Lazy-Load / Indexed**: Listed by name and short description only. Use `inspect_tool(name)` to retrieve the full manifest and guidance when needed.

Engineering tip: Use lazy-loading for specialized tools that are infrequently used to prevent prompt pollution and token waste.
