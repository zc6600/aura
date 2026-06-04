# Chapter 8: Gardeners — Specialized Subagents

"Gardeners" represent the specialized AI roles and personas spawned to execute specific operations on the Garden. 

## Multi-Agent Persona Dispatch

A single agent attempting to handle architecture, coding, testing, and reviewing in one long loop often runs into cognitive limits and blind spots. To counter this, Aura allows spawning specialized subagents (Gardeners) using the `subagent` tool.

Standard gardener personas (configured under `state/personas/` in JSON) include:
- **Architect**: Focuses on designing clean APIs, directory layouts, and data structures.
- **Coder**: Focuses on swift, compliant implementation of details.
- **Critic / Reviewer**: Focuses on code quality, testing correctness, and compliance checks.
- **Debugger**: Dispatched specifically when global test runs fail, resolving regressions without bloating the main workspace context.

## State Isolation and Session Rotation

When multiple subagents operate in parallel, there is a risk of database corruption or context pollution. Aura's `session_manager.rb` solves this by introducing **State Isolation**:
- Each subagent runs in its own process sandbox.
- When a subagent starts, `session_manager.rb` performs a **Session Rotation**, swapping the active SQLite database connection to the subagent's local DB (`state/sessions/<subagent_id>.db`).
- This isolates the subagent's execution trace and variables, preventing cross-agent trace pollution and memory bloat.
