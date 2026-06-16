# Aura OS Manual

This manual is organized around the four Diátaxis documentation modes. Pick the section by the kind of help you need, not by whether you are a user or contributor.

## Tutorials

Tutorials are learning paths. They teach Aura by taking you from zero to a concrete result.

- [Getting Started](tutorials/getting-started.md) - Install Aura, configure an LLM key, create a workspace, and run your first agent.
- [Build Your First Tool and Skill](tutorials/first-tool.md) - Create a local tool, pair it with a skill, and call it through the kernel.
- [Optimize a Slow Function with Ralph Mode](tutorials/optimize-slow-function.md) - Use a correctness test and benchmark to drive an agent optimization loop.
- [Make Your First Contribution](tutorials/first-contribution.md) - Build Aura, pick a small change, run focused tests, and update docs.
- [Tutorials TODO](tutorials/TODO.md) - Backlog of hands-on tutorials to write next.

## How-To Guides

How-to guides are task recipes. Use them when you already know the goal and need the steps.

- [Configure Aura](how-to/configure-aura.md) - Set local/global config, manage `.env` files, and choose LLM providers.
- [Manage Sessions](how-to/manage-sessions.md) - Create, switch, duplicate, export, import, rename, and delete isolated conversation sessions.
- [Extend with Skills and Tools](how-to/extend-with-skills-and-tools.md) - Install skills and tools, define tool manifests, configure MCP, and manage hint injection.
- [Work with Templates and Updates](how-to/work-with-templates-and-updates.md) - Update templates, sync workspaces, and use Aura's Git-backed workflow.
- [Maintain the Changelog](how-to/maintain-changelog.md) - Keep release notes and changelog automation consistent.
- [Test Aura](how-to/test-aura.md) - Run focused tests, integration tests, system tests, and CI checks.

## Reference

Reference pages are lookup material. They should be precise, complete, and light on narrative.

- [CLI Reference](reference/cli.md) - Commands, options, examples, and troubleshooting.
- [Configuration Reference](reference/configuration.md) - Config schema sections, keys, and value types.
- [Testing Reference](reference/testing.md) - Test directories, helpers, commands, and layer selection.
- [Python SDK](reference/python-sdk.md) - Programmatic workspace client and API surface.
- [Kernel Reference](reference/kernel.md) - Kernel commands and execution primitives.
- [Integrations Reference](reference/integrations.md) - MCP, LSP, hints, and external integration details.
- [Context Refactoring Reference](reference/context-refactoring.md) - Context-provider refactoring checklist and implementation details.

## Explanation

Explanation pages build understanding. Read them when you want the design model, tradeoffs, or historical context.

- [Architecture](explanation/architecture.md) - System layers and component boundaries.
- [Configuration Model](explanation/configuration-model.md) - How YAML config, `.env`, provider detection, and sessions fit together.
- [Workspace and Template Model](explanation/workspace-and-template-model.md) - How `.aura-workspace/`, `~/.aura-framework/repo`, and update commands relate.
- [Tools, Skills, and MCP](explanation/tools-skills-and-mcp.md) - Conceptual boundaries between executable tools, workflow skills, and external MCP tools.
- [Testing Strategy](explanation/testing-strategy.md) - Why the test suite is split into unit, integration, system, and daemon layers.
- [Daemon Architecture](explanation/daemon-architecture.md) - Background daemon, IPC, and startup-latency design.
- [Context and State](explanation/context-and-state.md) - How Aura assembles context and records state.
- [Memory Management](explanation/memory-management.md) - Event history, metabolism, retention, and summaries.
- [Session Architecture](explanation/session-architecture.md) - Why sessions use isolated SQLite databases.
- [Refactoring History](explanation/refactoring-history.md) - Historical notes on CLI refactoring.
- [CI Implementation History](explanation/ci-implementation-history.md) - Historical notes on CI implementation.
- [Implementation Summary](explanation/implementation-summary.md) - Historical implementation summary.

## Core Concepts

Aura OS is an AI-native operating system that treats the filesystem as an agent's workspace and extended memory. Instead of relying only on linear prompt history, Aura lets agents reason, persist, and extend their capabilities through structured files, custom tools, sessions, and environment hooks.

An Aura project keeps user files separate from agent runtime state:

```text
my_project/
├── .gitignore
├── src/
└── .aura-workspace/
    ├── config/
    │   └── config.yml
    ├── state/
    │   ├── active_session.txt
    │   └── sessions/
    │       └── default.db
    ├── tools/
    └── skills/
```

Main surfaces:

- **CLI**: `aura new`, `aura agent`, `aura chat`, `aura config`, `aura env`, `aura session`, `aura tools`, `aura skill`, `aura kernel`, and `aura update`.
- **Workspace**: Project root plus `.aura-workspace/`; current code scans both root-level and environment-level tool/skill locations.
- **Global Aura Home**: `~/.aura-framework/`, including global `.env` and the template repository at `~/.aura-framework/repo`.
- **Sessions**: Isolated SQLite databases under `.aura-workspace/state/sessions/`.
- **Tools and Skills**: Executable capabilities and markdown workflow instructions exposed to the agent.

## Need Help?

- Run `aura doctor` to diagnose environment issues.
- Run `aura info` to inspect system and workspace state.
- Run `aura help` to print CLI help.
- Check [GitHub Issues](https://github.com/zc6600/aura/issues) for known project issues.
