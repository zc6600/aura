# Context & State Management

## Scope & Paths

This document explains how Aura OS assembles the "Agent Mind" (the prompt) and manages long-term memory.
- **Framework Code**: `lib/aura/context/` (EnvironmentProvider, ToolProvider, StateProvider).
- **Project Context**: `state/aura.db` (SQLite) and `config/config.yml`.

---

## 1. Context Assembly Pipeline

The `Aura::Context::Manager` orchestrates three providers to build the prompt:

### A. Environment Provider (`Aura::Context::EnvironmentProvider`)
Scans the project structure to give the agent situational awareness.
- **Workspace Overview**: Lists files and directories (excluding hidden ones).
- **Global Rules**: Injects `AURA_README.md` if present.
- **Skills**: Scans `skills/*.md` frontmatter to list available workflows.

### B. Tool Provider (`Aura::Context::ToolProvider`)
Manages the "Tool Box".
- **Active Tools**: Fully expanded schemas for Core Tools + `auto_load: true` tools.
- **Tool Index**: Compact list (Name + Description) for other tools to save tokens.
- **Status Reporting**: Annotates tools with `[ACTIVE]`, `[failed]`, etc.
- **MCP Integration**: Merges external tools (`mcp.*`) into the list.

### C. State Provider (`Aura::Context::StateProvider`)
Connects to SQLite (`state/aura.db`) to retrieve history.
- **Recent Events**: The last N raw interactions (Phase, Tool, Payload).
- **Summaries**: High-level narrative of older history.
- **Variables**: Persistent Key-Value store (e.g., user preferences).

---

## 2. Metabolism (Memory Management)

To prevent context overflow, Aura implements a "Metabolism" cycle.

### Mechanism
1. **Trigger**: When event log size > `state_management.max_state_chars` (default 20000).
2. **Slice**: The Kernel keeps the last `recent_events_n` events (default 20).
3. **Synthesize**: Older events are summarized into a narrative paragraph via `NarrativeService`.
4. **Persist**: The summary is saved to the `summaries` table, and old raw events are deleted.

### Configuration (`config/config.yml`)
```yaml
state_management:
  db_path: "state/aura.db"
  max_state_chars: 20000
  recent_events_n: 20
```

---

## 3. Database Schema (SQLite)

The `state/aura.db` file contains three tables:

1. **events**:
   - `id`, `timestamp`, `phase` (observe/plan/execute), `tool`, `payload` (JSON).
2. **summaries**:
   - `id`, `timestamp`, `content` (text).
3. **variables**:
   - `key` (primary key), `value` (JSON/Text).
