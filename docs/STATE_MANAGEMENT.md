# State Management & Memory Metabolism

## Database Schema (SQLite)

Aura OS uses a structured database to prevent context overflow.

- `Event_Log`: Raw interaction history.
- `Summary_Vault`: Compressed historical snapshots.
- `Key_Value_Store`: Immutable variables (e.g., project goals, user preferences).

## Metabolism Logic (Compression)

To maintain performance, Aura OS implements a "Metabolism" cycle:

1. **Threshold Check**: When `Event_Log` length > `config.max_state_chars`.
2. **Summarization**: The oldest 70% of the log is sent to an LLM to be summarized.
3. **Consolidation**: The summary is saved to the `Summary_Vault`, and processed logs are archived.
4. **Prompt Construction**: The Agent receives: `[Summary] + [Active Window Logs] + [Key Variables]`.

---

# 🌌 Deep Design Doc (Part II: State Metabolism & Persistent Memory)

## 1. From Stream to Store

Traditional agents treat dialogue as an unstructured stream. Aura OS treats state as an indexable, queryable, compressible structured resource.

### Design Drivers

- Storage decoupling: Persist conversation to SQLite instead of in-memory buffers.
- Multi-dimensional memory: Separate event traces, fact snapshots, and core variables.
- Metabolic balance: Thresholds in `config.yml` control memory depth vs compute cost.

## 2. SQLite Schema

Located at `state/aura_state.db` with three core tables:

### 2.1 `Event_Log` (event stream)

- `timestamp`: UNIX timestamp
- `role`: System / Agent / Tool / User
- `content`: raw text or JSON payload
- `tokens`: estimated token usage
- `is_archived`: whether the record has been summarized

### 2.2 `Summary_Vault` (summary store)

- `period_start/end`: covered time span
- `summary_text`: distilled semantic summary
- `critical_nodes`: key turning points (e.g., tool completed)

### 2.3 `State_Variables` (key-value state)

- `key`: e.g., `current_user_id`, `project_phase`
- `value`: persisted value
- Never compressed: guarantees durable core context

## 3. Metabolism: Token Budget Control

When unarchived characters in `Event_Log` exceed `config.max_state_chars`:

1. Slicing: Process the oldest ~70% of records; keep the newest ~30% as the active window.
2. Distillation: Summarize the slice via an LLM into a factual summary.
3. Merging: Recursively merge with prior summaries; mark processed logs `is_archived = 1`.
4. Re-injection: Next prompt = `[System Prompt] + [Variable_Snapshot] + [Consolidated_Summary] + [Active_Window_Log]`.

## 4. Self-Healing Debugging Context

When `test.py` emits `stderr`:

- Mark the error as High-Priority State and persist to `Event_Log`.
- Ensure failure reasons survive summarization to prevent looping bugs.

## 5. Ruby Kernel ↔ SQLite

- Transactions: Commit logic output, manifest changes, and state updates atomically.
- Async summarization: Run metabolism in the background to avoid blocking agent responses.

## Developer Priorities (Part II)

1. Implement Ruby SQLite data-access layer.
2. Build metabolism scheduler keyed to `max_state_chars`.
3. Create prompt templating to compose `[Summary] + [Active Logs] + [Variables]`.
