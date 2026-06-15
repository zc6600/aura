# Tools, Skills, and MCP

Aura has three extension mechanisms. They solve different problems and should not be treated as interchangeable.

## Tools

Tools are executable capabilities. The agent calls them to do concrete work.

A tool normally has:

```text
tools/<tool_name>/
├── manifest.json
├── logic.py
└── logic.py.hint
```

The manifest describes the tool name, runtime, entrypoint, input schema, permissions, and memory behavior. The kernel registry converts tool manifests into callable tool definitions and executes the selected tool.

Use a tool when the agent needs a reliable operation:

- Read, write, or inspect workspace files.
- Query an index.
- Call a local script.
- Run a deterministic transformation.
- Wrap an external API in a controlled interface.

## Skills

Skills are markdown workflow instructions. They teach the agent how to approach a class of tasks.

A skill normally has:

```text
skills/<skill_name>/
├── SKILL.md
├── assets/
├── references/
└── scripts/
```

Use a skill when the agent needs procedure or judgment:

- A review checklist.
- A research workflow.
- A benchmark protocol.
- A domain-specific process that may call several tools.

Skills can mention required tools, but a skill is not itself a tool call. It is context that changes how the agent plans and acts.

## MCP

MCP connects Aura to external tool servers. An MCP server can expose many tools through stdio or SSE transport. Aura surfaces those tools under names like:

```text
mcp.<server>.<tool>
```

Use MCP when capability belongs outside the Aura workspace:

- A third-party service.
- A shared local server.
- A database server.
- A tool maintained by another ecosystem.

MCP config is defined under `tools/mcp/config.yml` in the workspace or global template repo.

## How They Work Together

A common pattern is:

1. A skill gives the agent a workflow.
2. The workflow tells the agent when to use local Aura tools.
3. MCP tools provide optional external capabilities.
4. Hints add local guidance to files or tools without bloating every prompt.

For example, a "software checking" skill may instruct the agent to inspect code, run tests with a local tool, and query an MCP issue tracker only when needed.

## Discovery and Precedence

Current code scans tools from both:

- `<project>/tools`
- `<project>/.aura-workspace/tools`

Current code lists skills from both:

- `~/.aura-framework/repo/skills`
- `<project>/skills`

When names collide, later discovered entries can override earlier entries in command output. Avoid duplicate tool or skill names unless you are deliberately shadowing a template capability.

See [Extend with Skills and Tools](../how-to/extend-with-skills-and-tools.md) for setup steps and [Integrations Reference](../reference/integrations.md) for MCP details.
