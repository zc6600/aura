# Integrations & External Protocols

How Aura OS connects to external tool ecosystems and protocols.

**Framework Code**: `lib/aura/ext/` (MCP, LSP) and `lib/aura/context/` (Hint system)  
**Project Context**: Integrations configured in `tools/mcp/` or via environment variables

---

## 1. MCP (Model Context Protocol)

Aura integrates the [Model Context Protocol](https://modelcontextprotocol.io/) to allow Agent projects to call tools served by external MCP servers.

### Integration Points

1. **Config Loading**: `Aura::MCP::Manager` loads `tools/mcp/config.yml` (relative to project root)
2. **Discovery**: `Aura::Context::ToolProvider` collects MCP tool schemas and converts them to JSON Schema format
3. **Native Tool Calling**: MCP tools are passed to LLM as structured tool definitions (not text descriptions in prompt)
4. **Execution**: `Aura::Kernel::ExecutionEngine` routes `mcp.*` calls to `Aura::MCP::Manager`

### Configuration (`tools/mcp/config.yml`)

```yaml
servers:
  - name: sqlite
    transport: stdio  # or 'sse'
    command: npx
    args: ["-y", "@modelcontextprotocol/server-sqlite", "--db", "state/aura.db"]
    auto_load: true
```

### Transport Types

**stdio:**
- Runs command as subprocess
- Communicates via stdin/stdout
- Best for local services

**sse (Server-Sent Events):**
- Connects to HTTP endpoint
- Receives events from server
- Best for remote services

### Security Note

MCP tools currently bypass the local verification step because they are external services. Future updates will support containerized stdio servers.

---

## 2. LSP (Language Server Protocol) - *Experimental*

Aura supports connecting to Language Servers for code intelligence.

### Usage

- The Kernel can launch an LSP client (e.g., for Ruby/Solargraph or Python/Pyright)
- **Tool**: `lsp_diagnostics` is a built-in tool that queries the active LSP server for errors/warnings in a file
- **Configuration**: LSP settings are currently passed via `Aura::Kernel::ExecutionEngine` options (not fully exposed in `config.yml` yet)

---

## 3. The Hint System (Semantic Sensing)

Aura's native "Sensing Layer" filters the environment to avoid token waste.

### Mechanisms

1. **.hint Files**: For any file `x.ext`, the system looks for `x.ext.hint` to provide a high-level summary
   - Example: `logic.py.hint` explains a complex tool's purpose

2. **@aura-hint Tags**: Kernel scans the first several lines of source files for `// @aura-hint:` or `# @aura-hint:`
   - Use this to embed guidance directly in code without separate files

3. **Dynamic Loading**: Only essential metadata is injected by default; full content is loaded only upon agent request (`read_file`)

### Configuration (`config/config.yml`)

```yaml
hints:
  auto_inject_readme: true   # Injects AURA_README.md
  scan_dot_hint_files: true
```

### Example Usage

**`.hint` file:**
```
tools/read_file/logic.py.hint:
This tool reads a file and returns its contents. Use for small to medium files.
For large files (>1000 lines), use read_file_chunk instead.
```

**`@aura-hint` tag:**
```python
# @aura-hint: This module handles authentication. Main entry point is login().
def login(username, password):
    ...
```

---

## Code References

- **MCP Manager**: `lib/aura/mcp/manager.rb`
- **ToolProvider**: `lib/aura/context/tool_provider.rb`
- **ExecutionEngine**: `lib/aura/kernel/execution_engine.rb`
- **Hint System**: `lib/aura/context/env_provider/hint_provider.rb`

---

## See Also

- [Skills & Tools](../user-guide/skills-and-tools.md) - User guide for tools and MCP
- [Kernel Documentation](kernel.md) - Tool execution pipeline
- [Architecture Overview](architecture.md) - System design
