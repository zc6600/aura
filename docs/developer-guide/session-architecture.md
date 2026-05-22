# Session Architecture

Technical design of Aura's session isolation system.

---

## Design Decision: Filesystem as Abstraction

### Why "One Session, One DB"?

**Advantages:**
- Simple and direct, natural isolation
- Each session can be independently backed up/deleted/migrated
- No complex multi-tenant logic needed
- SQLite files are small (typically < 10MB)

**Disadvantages:**
- Cross-session queries require opening multiple DBs (but rarely needed)
- Global search slightly slower (but can use index files)

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│            Application Layer (Session Management)        │
│                                                         │
│  SessionManager                                         │
│  - create("research-task")                              │
│  - activate("research-task")                            │
│  - list()                                               │
│  - delete("old-session")                                │
│  - duplicate("experiment-a", "experiment-b")            │
│  - export/import (backup/restore)                        │
│                                                         │
│  Storage: state/sessions.json (metadata)                 │
│           state/sessions/*.db (actual data)              │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Runner API (Session-Unaware)                 │
│                                                         │
│  runner = Runner.new(project_path)                      │
│  - Runner knows which DB to operate via env vars        │
│  - ENV["AURA_SESSION_NAME"] = "research-task"           │
│  - or ENV["AURA_STATE_DB_PATH"] = "/path/to/db"         │
│                                                         │
│  Runner responsibilities:                                │
│  - observe() → read context from current DB              │
│  - plan() → write plan event to current DB               │
│  - execute() → write execution event to current DB       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              State (Database Layer)                       │
│                                                         │
│  State.new(project_path)                                │
│  - Reads ENV["AURA_STATE_DB_PATH"] or                    │
│    ENV["AURA_SESSION_NAME"] to determine DB path         │
│  - state/sessions/{session_name}.db                     │
│                                                         │
│  Provided API:                                           │
│  - record_event(payload)                                │
│  - get_recent_events_structured                         │
│  - metabolize_if_needed                                 │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│         Environment Provider (Cross-Session Config)       │
│                                                         │
│  Stored in .aura/config/ or environment variables:       │
│  - User preferences                                      │
│  - Project conventions                                   │
│  - Tool configurations                                   │
│  - API keys (via .env)                                   │
│                                                         │
│  Does not depend on specific session DB, shared by all   │
└─────────────────────────────────────────────────────────┘
```

---

## Environment Contract

Sessions work through environment variables:

```ruby
ENV["AURA_SESSION_NAME"] = "research-task"
# or
ENV["AURA_STATE_DB_PATH"] = "/path/to/custom.db"
```

The Runner automatically detects and uses the active session via these variables, keeping layers decoupled.

---

## Data Isolation Guarantees

### Complete Session Isolation

```ruby
# Session A
sessions.activate("session-a")
runner_a = Runner.new(project_path)
runner_a.run("Analyze the codebase")
# → All events stored in state/sessions/session-a.db

# Session B
sessions.activate("session-b")
runner_b = Runner.new(project_path)
runner_b.run("Write documentation")
# → All events stored in state/sessions/session-b.db

# Two sessions' data are completely independent
# Session A cannot see Session B's events
# Session B cannot see Session A's events
```

### Verification

```ruby
require "sqlite3"

db_a = SQLite3::Database.new("state/sessions/session-a.db")
db_b = SQLite3::Database.new("state/sessions/session-b.db")

count_a = db_a.get_first_value("SELECT COUNT(*) FROM events")
count_b = db_b.get_first_value("SELECT COUNT(*) FROM events")

puts "Session A: #{count_a} events"
puts "Session B: #{count_b} events"
# Two counts are independent
```

---

## Performance Considerations

### SQLite File Sizes

- **Empty session**: ~50KB (schema only)
- **100 conversations**: ~2-5MB
- **1000 conversations**: ~20-50MB
- **After metabolism**: < 10MB (old events replaced by summaries)

### Multi-Session Overhead

```ruby
# 10 sessions total size
10 * 5MB = 50MB  # Completely acceptable

# Session switch time
< 10ms  # SQLite file opening is very fast
```

---

## Relationship with StateRecorder

```
SessionManager (Session Management)
  ↓ Sets environment variable
  ↓ ENV["AURA_SESSION_NAME"] = "my-session"
  
Runner (Orchestration)
  ↓ Creates State
  ↓ @state = State.new(project_path)
  ↓ State reads ENV to determine DB path
  
StateRecorder (Write)
  ↓ @recorder = StateRecorder.new(@state)
  ↓ @recorder.record_plan(plan)
  ↓ @recorder.record_execution(tool, result)
  
State (Database)
  ↓ Writes to state/sessions/my-session.db
  
StateProvider (Read)
  ↓ Reads from state/sessions/my-session.db
  ↓ Formats for LLM Context
```

---

## File Structure

```
project/
├── .aura/
│   ├── config/
│   │   └── config.yml              # Environment Provider (cross-session)
│   └── .env                        # API keys (cross-session)
│
├── state/
│   ├── sessions.json               # Session metadata
│   ├── active_session.txt          # Currently activated session name
│   └── sessions/
│       ├── default.db              # Default session
│       ├── research-task.db        # Research task session
│       ├── code-review.db          # Code review session
│       └── experiment-abc.db       # Experiment branch session
│
└── ...
```

---

## Future Extensions

### 1. Session Tags and Search

```ruby
sessions.create("bug-fix", tags: ["bug", "auth"])
sessions.create("feature", tags: ["feature", "payment"])

# Search by tag
bug_sessions = sessions.list.select { |s| 
  s[:tags].include?("bug") 
}
```

### 2. Session Merging (Advanced)

```ruby
# Merge insights from two related sessions
sessions.merge("experiment-a", "experiment-b", "merged-insights")
```

### 3. Session Templates

```ruby
# Create session from template (preset configuration)
sessions.create_from_template("new-feature", 
  template: "standard-dev-workflow")
```

---

## Summary

**SessionManager provides:**
- ✅ Simple "one-session-one-DB" abstraction
- ✅ Complete lifecycle management (create/switch/delete/backup)
- ✅ Natural data isolation
- ✅ Fully compatible with existing Runner/State

**Rationale for not virtualizing DB:**
- ✅ Filesystem is natural multi-tenant
- ✅ Each session completely independent
- ✅ Easy to understand and maintain
- ✅ Backup/migration extremely simple

**Environment Provider handles:**
- ✅ Cross-session configuration (user preferences, project conventions)
- ✅ Does not depend on specific session
- ✅ Shared by all sessions

This is a **concise, practical, and easily extensible** design!

---

## Code References

- **SessionManager**: `lib/aura/context/session_manager.rb`
- **State**: `lib/aura/kernel/state.rb`
- **Tests**: `test/context/test_session_manager.rb`

---

## See Also

- [User Guide: Sessions](../user-guide/sessions.md) - Session management for users
- [Context & State](context-and-state.md) - State management
- [Architecture Overview](architecture.md) - System design
