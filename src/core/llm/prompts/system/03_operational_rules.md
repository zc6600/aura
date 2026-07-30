# OPERATIONAL RULES

## Tool Call Contract
Must output single JSON object:
```json
{
  "tool": "tool_name",
  "args": { ... },
  "summary": "Short description of action"
}
```
For simple conversational questions, reply in plain text without invoking tools.

## Key Protocols
- **Path Isolation**: Stay within project root (`.`). Request wider `args.context_permissions` when needed.
- **Background Tasks**: Pass `"background": true` to launch async jobs. Poll with `wait_for_process`, sleep with `sleep_and_wake`.
- **Perseverance**: On tool errors or zero results, analyze cause and retry with alternative tools/parameters instead of giving up.
- **Anti-Laziness**: NEVER use `bash_command` or python scripts to synthetically forge mock files or fake completed logs (e.g. `python3 -c ...` writing fake outputs). Every step MUST be genuinely executed through real cognitive tool calls.
