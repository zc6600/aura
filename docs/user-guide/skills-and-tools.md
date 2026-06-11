# Skills and Tools

Extend Aura agent capabilities with custom tools, skills, and MCP integrations.

## Tools

Tools are executable programs that the agent can call to perform specific tasks.

### Tool Directory Structure

```
tools/[tool_name]/
├── logic.py         # Entry point (executable logic)
├── manifest.json    # Metadata and permissions
└── logic.py.hint    # (Optional) Usage tips for the agent
```

### manifest.json Specification

Every tool requires a `manifest.json` file:

```json
{
  "name": "my_tool",
  "description": "A brief description of what the tool does.",
  "runtime": "python3",
  "entry": "logic.py",
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
  },
  "memory": {
    "retention": "ephemeral",
    "summarize": true,
    "max_steps": 5
  }
}
```

#### Permission Conventions

- **file_system**: `"read-only" | "read-write" | "full-access"`
- **allow_paths**: Additional allowed path prefixes (relative to project root)
- **shell**: `boolean` - Allow shell command execution
- **self_edit**: `boolean` - Allow tool to modify its own source

#### Input Schema

Aura uses a strict subset of JSON Schema:
- Top-level `type` must be `"object"`
- `properties` defines arguments
- `required` lists mandatory fields

### Execution Contract

**Input:**
```bash
python3 logic.py '{"file_path": "config.yml"}'
```

Arguments are passed as JSON string via `sys.argv[1]`.

**Output:**
STDOUT must be a single JSON object:

```json
// Success
{"status": "ok", "content": "File contents..."}

// Failure
{"status": "failed", "error": "File not found"}
```

### Running Tools Manually

```bash
# Observe workspace first
aura kernel observe .

# Run a tool manually
aura kernel run_call read_file '{"file_path": "README.md"}' .
```

### How Tools are Exposed to the LLM

Aura uses **native tool calling** to expose tools to the LLM:

1. **Tool Discovery**: The system scans `tools/` directory and reads `manifest.json` files
2. **Schema Conversion**: Tool definitions are converted to JSON Schema format
3. **Native Injection**: Schemas are passed to the LLM API via the `tools` parameter (not in prompt text)
4. **Structured Calls**: The LLM returns structured tool calls, which Aura executes

**Benefits:**
- More reliable than text-based tool descriptions
- Follows OpenAI/Anthropic function calling standards
- Better token efficiency (no redundant tool text in prompts)
- Cleaner separation between context and tool definitions

**Example Tool Schema (what the LLM sees):**
```json
{
  "type": "function",
  "function": {
    "name": "read_file",
    "description": "Read a file from the filesystem",
    "parameters": {
      "type": "object",
      "properties": {
        "file_path": { 
          "type": "string",
          "description": "Path to the file to read"
        }
      },
      "required": ["file_path"]
    }
  }
}
```

**Note**: Earlier versions of Aura supported text-based tool injection where tool descriptions were embedded directly in the prompt. This has been completely removed in favor of native JSON Schema tool calling.

---

## Skills

Skills are markdown files that teach the agent how to perform specific workflows.

### Skill Structure

```
skills/[skill_name]/
├── SKILL.md           # Main skill definition
├── assets/            # (Optional) Resources
├── references/        # (Optional) Reference docs
└── scripts/           # (Optional) Helper scripts
```

### SKILL.md Format

```markdown
---
name: my-skill
description: Brief description of what this skill does
---

# My Skill

Instructions for the agent on how to perform this skill...
```

### Declaring Required Tools (Optional)

Skills may declare required tools in either of these ways:

- **Frontmatter**: add a `requires:` array (e.g. `requires: [read_file, run_command]`)
- **Body section**: add a `## Requirements` or `## Dependencies` section and list tools as bullets (e.g. `- read_file` or `- \`run_command\``)

Aura merges both sources and de-duplicates the final required tool list when rendering skill metadata.

### Built-in Skill Playbooks (Aura Harness)

Aura OS features a set of pre-installed, system-level skills under the **Aura Harness** family. These serve as execution-scaffolding templates that automatically configure prompt constraints, task anchors, and agent-loop modes for specialized tasks:

*   **`aura-harness`**: The main playbook router. It categorizes complex user requests and guides subagent orchestration or developer-critic loops.
*   **`aura-harness-software-check`**: Playbook scaffolding tailored for code quality, security audits, linting, compliance checks, and automated refactor validations.
*   **`aura-harness-perf-tuning`**: Playbook scaffolding specialized in benchmarking, system profiling, latency analysis, and code micro-optimizations.
*   **`aura-harness-research`**: Playbook scaffolding designed for academic paper parsing, mathematical modeling, parameter sweeps, and system simulations.

### Listing Skills

```bash
# List installed skills (including built-in playbooks)
aura skill list
```

### Adding Skills

```bash
# Install a skill from a Git URL or local directory
aura skill install <url_or_path> [name]
```

---

## MCP (Model Context Protocol)

MCP allows agents to connect to external tool servers and services.

### Configuration

Edit `.aura-workspace/tools/mcp/config.yml` for workspace-level, or `~/.aura-framework/repo/tools/mcp/config.yml` for global:

```yaml
servers:
  - name: google-search
    transport: sse
    url: "https://mcp-server.example.com/sse"
  
  - name: local-filesystem
    transport: stdio
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/search"]
  
  - name: sqlite
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-sqlite", "--db", "state/aura.db"]
    auto_load: true
```

### Transport Types

**stdio:**
- Runs command as subprocess
- Communicates via stdin/stdout

**sse (Server-Sent Events):**
- Connects to HTTP endpoint
- Receives events from server

### Using MCP Tools

MCP tools appear as `mcp.<server>.<tool>`:

```bash
# List tools (includes MCP tools)
aura tools list

# Use MCP tool
aura kernel run_call mcp.sqlite.query '{"sql": "SELECT * FROM events LIMIT 5"}' .
```

### Security Note

MCP tools currently bypass the local verification step because they are external services. Future updates will support containerized stdio servers.

---

## Hint System

Aura's native "Sensing Layer" filters the environment to avoid token waste.

### .hint Files

For any file `x.ext`, the system looks for `x.ext.hint`:

```
tools/read_file/
├── logic.py
├── logic.py.hint    # High-level summary for the agent
└── manifest.json
```

**Example `logic.py.hint`:**
```
This tool reads a file and returns its contents. Use this for small to medium files.
For large files (>1000 lines), use read_file_chunk instead.
```

### @aura-hint Tags

Embed guidance directly in source files:

```python
# @aura-hint: This module handles authentication. Main entry point is login().
def login(username, password):
    ...
```

The Kernel scans the first several lines for `// @aura-hint:` or `# @aura-hint:`.

### Configuration

```yaml
# config.yml
hints:
  auto_inject_readme: true   # Injects AURA_README.md
  scan_dot_hint_files: true
```

---

## Tool Lifecycle

### 1. Create Tool

```bash
# Create tool directory
mkdir -p tools/my_tool
cd tools/my_tool

# Create files
touch logic.py manifest.json
```

### 2. Write Manifest

Create `manifest.json` with tool metadata and permissions.

### 3. Implement Logic

Write `logic.py` that:
- Reads JSON args from `sys.argv[1]`
- Performs task
- Outputs JSON to STDOUT

### 4. Test Tool

```bash
# Tool is validated automatically when first used
# Or manually:
aura tools list
```

### 5. Use Tool

The agent automatically discovers and use the tool once it passes validation.

---

## Best Practices

### 1. Tool Design

- **Single responsibility**: One tool, one task
- **Clear manifest**: Good description and schema
- **Comprehensive tests**: Verify all edge cases
- **Appropriate permissions**: Request minimum necessary access

### 2. Skill Design

- **Clear SKILL.md**: Detailed instructions for the agent
- **Examples**: Show expected inputs and outputs
- **References**: Link to external documentation

### 3. MCP Integration

- **Auto-load trusted servers**: Set `auto_load: true` for reliable servers
- **Use stdio for local**: Prefer stdio for local services
- **Document dependencies**: List required commands (npx, python, etc.)

### 4. Hint Files

- **Keep hints concise**: 2-3 sentences maximum
- **Focus on usage**: When to use, when not to use
- **Update regularly**: Keep hints in sync with code

---

## Troubleshooting

### Tool not appearing in list

```bash
# Check manifest syntax
cat tools/my_tool/manifest.json | python3 -m json.tool

# Verify tool structure
ls -la tools/my_tool/

```

### MCP server not connecting

```bash
# Test server manually
npx -y @modelcontextprotocol/server-sqlite --db state/aura.db

# Check config syntax
cat .aura-workspace/tools/mcp/config.yml
```

### Tool execution fails

```bash
# Run tool manually
cd tools/my_tool
python3 logic.py '{"arg": "value"}'

# Check permissions in manifest
cat manifest.json | grep -A 5 permissions
```

---

## See Also

- [Kernel Documentation](../developer-guide/kernel.md) - Tool execution pipeline
- [Configuration](configuration.md) - Tool configuration
- [Integrations](../developer-guide/integrations.md) - MCP and LSP details
