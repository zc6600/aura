# Integrations & External Protocols

## Scope & Paths

This document covers how Aura OS connects to external tool ecosystems and protocols.
- **Framework Code**: `lib/aura/ext/` (MCP, LSP) and `lib/aura/context/` (Hint system).
- **Project Context**: Integrations are configured in `tools/mcp/` or via environment variables.

---

## 1. MCP (Model Context Protocol)

Aura integrates the [Model Context Protocol](https://modelcontextprotocol.io/) to allow Agent projects to call tools served by external MCP servers.

### Integration Points
1. **Config Loading**: `Aura::MCP::Manager` loads `tools/mcp/config.yml` (relative to project root).
2. **Discovery**: `Aura::Context::ToolProvider` injects MCP tools into the prompt as `mcp.<server>.<tool>`.
3. **Execution**: `Aura::Kernel::ExecutionEngine` routes `mcp.*` calls to `Aura::MCP::Manager`.

### Configuration (`tools/mcp/config.yml`)
```yaml
servers:
  - name: sqlite
    transport: stdio  # or 'sse'
    command: npx
    args: ["-y", "@modelcontextprotocol/server-sqlite", "--db", "state/aura.db"]
    auto_load: true
```

### Security Note
MCP tools currently bypass the local `test.py` verification step because they are external services. Future updates will support containerized stdio servers.

---

## 2. LSP (Language Server Protocol) - *Experimental*

Aura supports connecting to Language Servers for code intelligence.

### Usage
- The Kernel can launch an LSP client (e.g., for Ruby/Solargraph or Python/Pyright).
- **Tool**: `lsp_diagnostics` is a built-in tool that queries the active LSP server for errors/warnings in a file.
- **Configuration**: LSP settings are currently passed via `Aura::Kernel::ExecutionEngine` options (not fully exposed in `config.yml` yet).

---

## 3. The Hint System (Semantic Sensing)

Aura's native "Sensing Layer" filters the environment to avoid token waste.

### Mechanisms
1. **.hint Files**: For any file `x.ext`, the system looks for `x.ext.hint` to provide a high-level summary.
   - Example: `logic.py.hint` explains a complex tool's purpose.
2. **@aura-hint Tags**: Kernel scans the first several lines of source files for `// @aura-hint:` or `# @aura-hint:`.
   - Use this to embed guidance directly in code without separate files.
3. **Dynamic Loading**: Only essential metadata is injected by default; full content is loaded only upon agent request (`read_file`).

### Configuration (`config/config.yml`)
```yaml
hints:
  auto_inject_readme: true   # Injects AURA_README.md
  scan_dot_hint_files: true
```
