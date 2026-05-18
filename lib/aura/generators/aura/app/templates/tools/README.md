# Tools

Tools are executable capabilities that the Kernel can call. Each tool lives in its own directory under `tools/` and is validated and executed according to the tool protocol.

## Directory Layout

```text
tools/<tool_name>/
├── manifest.json    # Metadata, runtime, permissions, schemas
├── logic.py         # Entry point (default)
├── test.py          # Verification test (recommended; may be required by config)
└── logic.py.hint    # Optional guidance for the agent
```

## Tool Contract

- The Kernel passes a JSON string as `sys.argv[1]`.
- The tool must print exactly one JSON object to stdout.
- Prefer:
  - success: `{ "status": "ok", ... }`
  - failure: `{ "status": "failed", "error": "...", "code": "..." }`

## Permissions & Path Isolation

When strict path isolation is enabled (`security.strict_path_isolation: true` in `config/config.yml`), the Kernel injects:

- `strict_mode`: `true`
- `context_permissions`: allow-listed path prefixes
- `forbidden_extensions` / `read_only_directories`

Tools that read/write files should enforce these inputs.

## MCP Tools

MCP server configuration lives under `tools/mcp/`. See:

- `tools/mcp/README.md`
- `tools/mcp/config.yml`

