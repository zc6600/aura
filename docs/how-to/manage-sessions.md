# Session Management

Sessions provide isolated conversation contexts, each with its own memory database.

## What Are Sessions?

Aura uses a **"one session, one database"** architecture:

```
.aura-workspace/state/
├── active_session.txt          # Current session name
├── sessions/
│   ├── default.db              # Default session
│   ├── research-task.db        # Research session
│   ├── code-review.db          # Code review session
│   └── experiment-abc.db       # Experiment session
└── aura.db                     # (Legacy, auto-migrated)
```

**Benefits:**
- Complete data isolation between conversations
- Independent backup/delete/migrate per session
- No complex multi-tenant logic needed
- Small SQLite files (typically < 10MB)

---

## Session Commands

### List Sessions

```bash
aura session list
```

**Output:**
```
Sessions:
  → research-task                   45 events  (last: 2024-01-15 14:30)
    default                         12 events  (last: 2024-01-14 10:00)
    experiment-abc                   8 events  (last: 2024-01-13 16:45)

Total: 3 session(s)
```

### Create Session

```bash
aura session create code-review
```

**Output:**
```
✓ Created session: code-review
  Database: /path/to/project/.aura-workspace/state/sessions/code-review.db
✓ Activated session: code-review
```

### Switch Session

```bash
aura session switch research-task
```

**Output:**
```
✓ Switched to session: research-task
  Database: /path/to/project/.aura-workspace/state/sessions/research-task.db
```

### View Current Session

```bash
aura session current
```

**Output:**
```
Current session: research-task
Database: /path/to/project/.aura-workspace/state/sessions/research-task.db
```

### Delete Session

```bash
aura session delete old-session
```

**Output:**
```
Are you sure you want to delete session 'old-session'? [y/N] y
✓ Deleted session: old-session
```

### Duplicate Session (Branching)

Create a copy for experimentation:

```bash
aura session duplicate working-version refactor-experiment
```

**Output:**
```
✓ Duplicated 'working-version' to 'refactor-experiment'
```

### Export Session (Backup)

```bash
aura session export important-project /backup/project.db
```

**Output:**
```
✓ Exported session 'important-project' to: /backup/project.db
```

### Import Session (Restore)

```bash
aura session import /backup/project.db restored-project
```

**Output:**
```
✓ Imported session 'restored-project' from: /backup/project.db
```

---

## Session Naming Best Practices

### Good Names

```bash
aura session create fix-auth-bug
aura session create add-payment-feature
aura session create refactor-database-layer
```

### Bad Names

```bash
aura session create session1  # Too generic
aura session create test       # Not descriptive
aura session create temp       # Unclear purpose
```

**Tips:**
- Use descriptive, task-specific names
- Include action verbs (fix, add, refactor)
- Avoid generic names like "test" or "temp"

---

## Common Workflows

### Workflow 1: Task Isolation

Separate different tasks into isolated sessions:

```bash
# Task 1: Research
aura session create research-api
aura agent --goal "Research best practices for API design"

# Task 2: Implementation
aura session create implement-api
aura agent --goal "Implement REST API based on research"

# Sessions are completely isolated
```

### Workflow 2: Experiment Branching

Try risky changes without affecting working state:

```bash
# Start with working session
aura session switch working-version

# Create experimental branch
aura session duplicate working-version refactor-experiment
aura session switch refactor-experiment

# Experiment safely
aura agent --goal "Refactor the authentication module to use JWT"

# If successful, merge insights manually
# If failed, just delete experiment
aura session delete refactor-experiment
```

### Workflow 3: Backup Before Major Changes

```bash
# Backup current state
aura session export production-fix /backup/production-fix-$(date +%Y%m%d).db

# Proceed with changes
aura agent --goal "Fix the production database migration issue"

# If something goes wrong, restore
aura session import /backup/production-fix-20240115.db restored-fix
aura session switch restored-fix
```

---

## When to Use Sessions vs Variables

### Use Sessions For:

- Different conversation contexts
- Isolated experiment branches
- Task-specific memory
- Temporary work that may be discarded

### Use Variables For:

- Cross-session preferences
- Persistent user settings
- Project-wide conventions

**Example:**

```bash
# Session-specific: Current task context
aura session create fix-login-bug

# Cross-session: User preference
# Stored in variables table, accessible from all sessions
```

---

## Shell Integration

When you start `aura agent`, it automatically loads the current session:

```bash
aura agent
# Output: 📝 Session: research-task (if verbose mode)
```

### Slash Commands in Agent

Inside `aura agent`, you can switch sessions:

```
/session list
/session switch code-review
/session create new-task
```

---

## Performance Considerations

### SQLite File Sizes

- **Empty session**: ~50KB (schema only)
- **100 conversations**: ~2-5MB
- **1000 conversations**: ~20-50MB
- **After metabolism**: < 10MB (old events replaced by summaries)

### Multi-Session Overhead

```bash
# 10 sessions total size
10 * 5MB = 50MB  # Completely acceptable

# Session switch time
< 10ms  # SQLite file opening is very fast
```

---

## Environment Contract

Sessions work through environment variables:

```bash
ENV["AURA_SESSION_NAME"] = "research-task"
# or
ENV["AURA_STATE_DB_PATH"] = "/path/to/custom.db"
```

The Runner automatically detects and uses the active session via these variables.

---

## Best Practices

### 1. Clean Up Old Sessions

Regularly remove experimental sessions:

```bash
# List sessions
aura session list

# Delete old experiments
aura session delete experiment-abc
aura session delete temp-test
```

### 2. Backup Important Sessions

Before major operations:

```bash
aura session export critical-task /backups/critical-task-$(date +%Y%m%d).db
```

### 3. Use Descriptive Names

```bash
# Good
aura session create migrate-db-to-postgresql

# Bad
aura session create task1
```

### 4. Leverage Duplication

Before risky changes:

```bash
aura session duplicate stable-version experimental-change
aura session switch experimental-change
# Experiment safely
```

---

## Troubleshooting

### Session not found

```bash
# List all sessions
aura session list

# Check if session file exists
ls .aura-workspace/state/sessions/
```

### Switching sessions doesn't work

```bash
# Verify current session
aura session current

# Check active_session.txt
cat .aura-workspace/state/active_session.txt
```

### Session database corrupted

```bash
# Restore from backup
aura session import /backup/session.db restored-session
aura session switch restored-session
```

---

## See Also

- [Session Architecture](../explanation/session-architecture.md) - Technical design details
- [CLI Reference](../reference/cli.md) - Session commands
- [Context & State](../explanation/context-and-state.md) - State management
