# Aura OS Documentation

Welcome to the Aura OS documentation. This guide is organized by audience and purpose.

## Quick Start

- **New to Aura?** → [Getting Started Guide](user-guide/getting-started.md)
- **Need command reference?** → [CLI Reference](user-guide/cli-reference.md)
- **Want to contribute?** → [Developer Guide](developer-guide/architecture.md)

---

## Are you a User or Contributor?

### 👤 I'm a User

I want to install Aura, create projects, and use the agent.

**Start here:**
- [Getting Started](user-guide/getting-started.md) - Installation, setup, first project
- [CLI Reference](user-guide/cli-reference.md) - Complete command reference
- [Configuration](user-guide/configuration.md) - Config system, LLM setup, .env
- [Sessions](user-guide/sessions.md) - Session management and isolation
- [Skills & Tools](user-guide/skills-and-tools.md) - Using tools, skills, MCP
- [Workflows](user-guide/workflows.md) - Update workflows, version control

### 🔧 I'm a Contributor

I want to understand the architecture and contribute to the framework.

**Start here:**
- [Architecture Overview](developer-guide/architecture.md) - System design and layers
- [Kernel & Execution](developer-guide/kernel.md) - AgentLoop, Runner, ExecutionEngine
- [Context & State](developer-guide/context-and-state.md) - State management, context assembly
- [Memory Management](developer-guide/memory-management.md) - Metabolism, retention, summaries
- [Session Architecture](developer-guide/session-architecture.md) - Session isolation design
- [Integrations](developer-guide/integrations.md) - MCP, LSP, Hint system
- [CHANGELOG & CI/CD](developer-guide/changelog-guide.md) - Release management and automation
- [Testing & CI/CD](developer-guide/testing.md) - Test strategy, CI workflow
- [Python SDK](developer-guide/sdk.md) - Programmatic workspace client & API

---

## Documentation Structure

```
docs/
├── README.md                          # This file - documentation index
├── user-guide/                        # For end users
│   ├── getting-started.md             # Installation and quick start
│   ├── cli-reference.md               # CLI command reference
│   ├── configuration.md               # Configuration system
│   ├── sessions.md                    # Session management
│   ├── skills-and-tools.md            # Tools, skills, MCP
│   └── workflows.md                   # Common workflows
├── developer-guide/                   # For framework contributors
│   ├── architecture.md                # System architecture
│   ├── kernel.md                      # Kernel and execution
│   ├── context-and-state.md           # Context and state management
│   ├── memory-management.md           # Memory metabolism
│   ├── session-architecture.md        # Session isolation
│   ├── integrations.md                # External integrations
│   ├── changelog-guide.md             # CHANGELOG and release automation
│   ├── testing.md                     # Testing and CI/CD
│   └── sdk.md                         # Python SDK & programmatic client
└── changelog/                         # Development history
    ├── refactoring.md                 # CLI refactoring history
    └── ci-implementation.md           # CI/CD implementation history
```

---

## Key Concepts

### What is Aura OS?

Aura OS is an AI-native operating system that treats the filesystem as an agent's workspace and extended memory. Instead of relying solely on linear prompt history, Aura OS enables agents to reason, persist, and extend their capabilities freely through structured files, custom tools, and automated environment hooks.

### Core Features

- **Folder-as-a-Workspace**: Context, memory, and tools organized as directory items
- **Global CLI**: Packageable npm package with system-wide commands
- **Git-under-the-hood**: Version control mapped to clean CLI operations
- **Metabolism & SQLite Memory**: Persistent event histories with automatic summaries
- **Hierarchical Configurations**: Dot-notation for nested parameters

### Architecture Highlights

- **Layered Design**: UI → Application → Kernel → Context → Infrastructure
- **Event-Driven**: All communication through EventBus
- **Read-Write Separation**: StateRecorder (write) vs StateProvider (read)
- **Session Isolation**: Each conversation has its own database
- **Tiered Memory**: Different retention strategies for different event types

---

## Need Help?

- Run `aura doctor` to diagnose environment issues
- Run `aura info` to see system and workspace information
- Run `aura help` for command reference
- Check [GitHub Issues](https://github.com/zc6600/aura/issues) for known problems

---

## Contributing

Want to improve this documentation? See the [Developer Guide](developer-guide/testing.md) for testing and contribution guidelines.
