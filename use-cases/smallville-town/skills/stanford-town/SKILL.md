---
name: stanford-town
description: Replicates the Stanford Smallville Generative Agents simulation using the Host-Agent and Subagent architecture without prompt leakage.
requires:
  - subagent
  - blackboard
  - mailbox
  - groupchat
---

# Stanford Smallville Generative Agents Orchestration (Town Host Mode)

This skill orchestrates Smallville using the **Town Host & Resident Subagent** paradigm for 100% genuine emergent social behaviors.

## Architectural Model
- **Main Agent (Town Host / Clock Simulator)**: Broadcasts environment time and state to blackboard. NEVER prompts subagents with hardcoded plots (e.g. "Isabella should invite Tom now").
- **Resident Subagents**: Spawned hourly via `subagent(persona="...", async_mode=true)` with isolated state databases. Make decisions based purely on their own memory stream and mailbox notifications.

---

## hourly Execution Loop (00:00 to 23:00)

### 1. Environmental Time Broadcast (Host Agent)
The Host Agent updates the town clock on the blackboard without narrative hints:

```json
blackboard: {
  "action": "write",
  "key": "town_clock",
  "content": {
    "hour": 8,
    "time_str": "08:00 AM",
    "weather": "sunny",
    "active_locations": ["Hobbs Cafe", "Willows Market", "Smallville Library", "Johnson Park"]
  }
}
```

### 2. Parallel Resident Dispatch (Host Agent)
Host Agent dispatches residents concurrently with neutral time context:

```json
subagent: {
  "persona": "isabella_rodriguez",
  "goal": "Read current town_clock and your mailbox. Based on your persona and memory stream, decide your action and dialogue for 08:00 AM.",
  "async_mode": true,
  "name": "isabella_0800"
}
```

```json
subagent: {
  "persona": "klaus_mueller",
  "goal": "Read current town_clock and your mailbox. Based on your persona and memory stream, decide your action and dialogue for 08:00 AM.",
  "async_mode": true,
  "name": "klaus_0800"
}
```

```json
subagent: {
  "persona": "tom_moreno",
  "goal": "Read current town_clock and your mailbox. Based on your persona and memory stream, decide your action and dialogue for 08:00 AM.",
  "async_mode": true,
  "name": "tom_0800"
}
```

### 3. Asynchronous Sync & Harvest (Host Agent)
1. Host agent calls `sleep_and_wake(seconds=5)` to let all parallel resident subagents finish.
2. Reads new messages via `mailbox(action="list")` and town actions via `blackboard(action="list")`.
3. Advances the town clock to the next hour.

---

## Strict Emergence Rules
- **ZERO SCRIPT LEAKAGE**: The Host Agent MUST NOT tell subagents what plot event happens. All social activities (party invitations, campaign debates) MUST emerge autonomously from residents' personas and mailbox communications.
- **NO SYNTHETIC PYTHON MOCKING**: All hourly actions MUST be executed by real LLM cognitive subagents.
