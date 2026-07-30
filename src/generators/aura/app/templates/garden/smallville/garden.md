# Smallville Generative Agents (Stanford Town Replication)

## Overview
This garden playbook replicates the core architecture of the Stanford Smallville paper (*Generative Agents: Interactive Simulacra of Human Behavior*).

## Required Tools & Capabilities
- `subagent`: Spawns isolated agent processes for town residents.
- `blackboard`: Shared environment state (locations, party invitations, town square status).
- `mailbox`: Point-to-point 1-on-1 private dialogue between agents.
- `groupchat`: Public square and party broadcast messages.

## Resident Personas
- **Isabella Rodriguez** (`state/personas/isabella.json`): Cafe owner preparing a Valentine's Day party.
- **Tom Moreno** (`state/personas/tom.json`): Town candidate running for election.
- **Klaus Mueller** (`state/personas/klaus.json`): Library researcher studying computational social science.

## Multi-Agent Execution Flow
1. **Morning Planning**: Dispatch parallel subagents for each resident to draft daily schedules.
2. **Perception & Interaction Loop**:
   - Check blackboard for town location states.
   - If two agents meet at the cafe/square, send messages via `mailbox`.
3. **Night Reflection & Memory Metabolism**:
   - Summarize daily observations and save reflections into memory streams.
