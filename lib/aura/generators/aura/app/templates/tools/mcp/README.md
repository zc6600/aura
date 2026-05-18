# MCP (Model Context Protocol)

This directory configures external MCP servers and exposes their tools to the Aura Kernel.

## Files

- `config.yml`: MCP server definitions

## Naming

MCP tools are surfaced as:

```text
mcp.<server_name>.<tool_name>
```

Example:

```text
mcp.sqlite.query
```

## Configuration

Minimal example:

```yaml
servers:
  - name: sqlite
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-sqlite", "--db", "state/aura.db"]
    env: {}
    timeout: 30
    auto_load: true
```

### Transports

#### stdio

Use stdio for local executables:

```yaml
transport: stdio
command: ruby
args: ["path/to/server.rb"]
env:
  FOO: bar
timeout: 30
```

#### sse

Use SSE for remote servers:

```yaml
transport: sse
url: "http://localhost:3001/sse"
headers:
  Authorization: "Bearer <token>"
timeout: 30
```

## Hints

You can attach guidance that shows up in tool listings:

```yaml
servers:
  - name: web
    transport: sse
    url: "http://localhost:3001/sse"
    hint: "Use this for web searches."
    tool_hints:
      search: "Prefer precise queries; include a date when needed."
```

