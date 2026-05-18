# Aura Framework Architecture

## Scope & Paths

This documentation describes the internal architecture of the **Aura Framework** (the Ruby gem code in this repository).
- **Framework Root**: The root of this repository (`/Users/frank/Desktop/Towards AGI/aura/aura`).
- **Generated Project**: The directory created by `aura new <project_name>`.
- **Docs Location**: All internal implementation docs are located in `docs/internals/`.

## Module Map

The framework documentation is organized by functional modules rather than implementation languages.

### 1. [Kernel & Execution](KERNEL.md)
The core runtime engine that orchestrates the agent's lifecycle.
- **Execution Engine**: `Aura::Kernel::Runner` lifecycle (Observe -> Plan -> Execute -> Learn).
- **Tool Protocol**: The "Evolution Loop", tool structure (`logic.py`, `manifest.json`), and validation gates.
- **Security**: Sandboxing, path isolation, and permission enforcement.
- **Code Reference**: `lib/aura/kernel/`, `lib/aura/cli.rb`.

### 2. [Context & State](CONTEXT.md)
How the agent maintains continuity and memory.
- **State Management**: SQLite schema (`state/aura.db`), event logging, and key-value storage.
- **Metabolism**: Context slicing and narrative generation to manage token windows.
- **Context Assembly**: Building the prompt context from state and environment.
- **Code Reference**: `lib/aura/db.rb`, `lib/aura/metabolism.rb`.

### 3. [Integrations & Protocols](INTEGRATIONS.md)
Interfaces with the external world.
- **Model Context Protocol (MCP)**: Client/Server architecture for connecting to external data sources.
- **Hint System (LSP-lite)**: `.hint` files and `@aura-hint` tags for efficient code sensing.
- **Code Reference**: `lib/aura/mcp/`, `lib/aura/extension/`.

### 4. [Framework Development](TESTING.md)
Guide for contributors to the Aura framework itself.
- **TDD Strategy**: How to run framework tests.
- **Test Matrix**: Coverage of CLI, Generators, and Runtime logic.
- **Code Reference**: `test/`.

### 5. [Global CLI Setup & PATH Integration](SETUP_AND_CLI.md)
Details on packaging, one-click installation, and global binary resolution.
- **Setup Script**: `bin/setup.sh` automated lifecycle.
- **PATH Resolution**: Gem binaries and version manager shims (`Gem.bindir`).
- **Source Root Check**: Framework pollution protection rules in `entry.rb`.

