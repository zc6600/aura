# Aura OS Architecture Specification

## Overview
Aura OS is an AI-native operating system designed to provide a structured, file-based environment for autonomous agents. Unlike traditional agents that rely solely on linear prompt history, Aura OS treats the file system as the agent's "workspace" and "extended memory."

### Folder-as-a-Workspace Philosophy
Agents interact with the environment primarily through files and directories. The workspace organizes capabilities (`tools/`), reference knowledge (`knowledge/`), state (`state/`), and configuration (`config.yml`), enabling persistent memory, reproducible behavior, and composable collaboration across runtimes.

## Core Components

### 1. The Ruby Kernel (The Host)
The "Heart" of Aura OS. It is a daemon written in Ruby responsible for:
- **File System Monitoring**: Watching for changes in `tools/` and `knowledge/`.
- **Process Orchestration**: Routing execution to appropriate runtimes (Python, Ruby, Shell).
- **Security Enforcement**: Validating path access and tool permissions.

### 2. The Tool Protocol
Every capability is a self-contained directory:
- `logic.py`: The execution logic.
- `manifest.json`: Metadata, dependencies, and permissions.
- `test.py`: Validation script required for tool activation.

### 3. State & Metabolism (SQLite)
- **Persistence**: All events are stored in `state/aura_state.db`.
- **Metabolism**: A background process that compresses context when it exceeds the `max_state_chars` limit defined in `config.yml`.

### 4. The Hint System
- **Context Injection**: Automatically discovers `.hint` files and `AURA_README.md` to provide the Agent with environmental awareness without bloating the prompt.
