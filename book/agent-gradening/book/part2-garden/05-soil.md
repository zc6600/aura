# Chapter 5: Soil — The Infrastructure

The "Soil" represents the persistent storage and configuration infrastructure that supports the agent's work. In Aura OS, the Soil is realized through the workspace's hidden environment directory and relational databases.

## Workspace Isolation: The `.aura` Directory

To prevent polluting the user's primary codebase, Aura isolates all execution logs, config files, and internal agent state inside a hidden `.aura/` directory at the project root. This directory contains:
- `config/config.yml`: Defining execution limits, safety boundaries, and compression options.
- `state/`: Persistent state stores.
- `tools/` and `skills/`: The available capabilities (Harness).

This folder-as-a-workspace structure acts as the medium in which all agent artifacts grow.

## Memory Persistence: The SQLite Session DB

Rather than holding session history in a volatile prompt memory, Aura records all execution events, active variable bindings, and step summaries in a session-specific SQLite database located under `.aura/state/sessions/<session_name>.db`. 

This database maintains:
1. **`events`**: A structured chronological log of every step, thought, tool execution, and output.
2. **`variables`**: A key-value store of active, long-lived parameters and execution states.
3. **`summaries`**: Consolidated narratives generated periodically to condense past trajectory segments.

By storing this in a relational database, the agent can query its own history dynamically (using SQL tools) instead of maintaining an ever-expanding, linear chat history.
