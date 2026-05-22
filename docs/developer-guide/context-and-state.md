# Context & State Management

How Aura OS assembles the "Agent Mind" (the prompt) and manages long-term memory.

**Framework Code**: `lib/aura/context/` (EnvironmentProvider, ToolProvider, StateProvider, StateRecorder, SessionManager, LLMContext)  
**Project Context**: `state/sessions/*.db` (SQLite, session-isolated) and `config/config.yml`  
**Memory Metabolism**: `lib/aura/kernel/memory_metabolizer.rb`

---

## Context Assembly Pipeline

The `Aura::Context::Manager` orchestrates three providers to build the prompt:

### A. Environment Provider (`Aura::Context::EnvironmentProvider`)

Scans the project structure to give the agent situational awareness.

**Features:**
- **Workspace Overview**: Lists files and directories (excluding hidden ones)
- **Global Rules**: Injects `AURA_README.md` if present
- **Skills**: Scans `skills/*.md` frontmatter to list available workflows

### B. Tool Provider (`Aura::Context::ToolProvider`)

Manages the "Tool Box".

**Features:**
- **Active Tools**: Fully expanded schemas for Core Tools + `auto_load: true` tools
- **Tool Index**: Compact list (Name + Description) for other tools to save tokens
- **MCP Integration**: Merges external tools (`mcp.*`) into the list
- **Native Tool Calling**: Tool schemas are converted to JSON format for LLM native function calling (no text injection)

### C. State Provider (`Aura::Context::StateProvider`)

Connects to SQLite (`state/sessions/*.db`) to retrieve history.

**Features:**
- **Recent Events**: The last N raw interactions in **chronological order** (Phase, Tool, Payload, Thought)
- **Summaries**: High-level narrative of older history (both Call Summaries and Metabolism Summaries)
- **Variables**: Persistent Key-Value store (e.g., user preferences)

---

## Read-Write Separation Pattern

Aura implements a clean separation between state reading and writing:

### StateRecorder (Write Side)

**Location**: `lib/aura/context/state_recorder.rb`  
**Purpose**: Type-safe event recording interface

**Methods:**
- `record_user(input)` - Record user input
- `record_plan(plan_hash)` - Record LLM plan with tool, args, summary, thought
- `record_execution(tool, result)` - Record tool execution results
- `record_interception(tool, advice)` - Record tool halts
- `record_custom(phase, payload)` - Record custom events

### StateProvider (Read Side)

**Location**: `lib/aura/context/state_provider.rb`  
**Purpose**: Format events for LLM context

**Features:**
- Returns events in **chronological order** (not grouped by layers)
- Extracts and prioritizes `thought` field from plan events
- Includes both call summaries and metabolism summaries
- Applies context compression if needed

---

## Event Structure Specification

### 1. User Event

```ruby
{
  phase: "user",
  content: "List all Ruby files",
  call_seq: nil  # Optional, for correlation
}
```

### 2. Plan Event

```ruby
{
  phase: "plan",
  tool: "bash_command",
  args: { "command" => "find . -name '*.rb'" },
  thought: "I'll use find to search for Ruby files",
  summary: "Finding Ruby files"
}
```

### 3. Execution Event

```ruby
{
  phase: "execution",
  tool: "bash_command",
  result: {
    status: "ok",
    output: "file1.rb\nfile2.rb",
    success: true
  },
  call_seq: 42  # Correlates to user event ID
}
```

### 4. Interception Event

```ruby
{
  phase: "interception",
  tool: "dangerous_tool",
  advice: "Tool is not safe to run",
  reason: "Security check failed"  # Optional
}
```

---

## Context Compression

When assembling the prompt at runtime, if total length exceeds `max_state_chars`, Aura applies multi-tiered compression:

1. **Event-level Payload Truncation**: Truncates raw event payloads > `event_max_chars` (default 800)
2. **Event Count Reduction**: Trims older events down to `event_min_count_threshold` (default 10)
3. **Section Discarding**: Drops less critical sections based on `drop_order`
4. **Extreme History Trim**: Drops history down to single latest event

**Note**: Persistent Facts (`:knowledge`) and core Agent Memory structures are preserved.

---

## Database Schema (SQLite)

Each session database contains:

### events table

- `id` - Auto-increment primary key
- `timestamp` - Unix timestamp
- `phase` - Event phase (user/plan/execution/observe/learn/interception)
- `tool` - Tool name (nullable)
- `payload` - JSON payload with event details

### summaries table

- `id` - Auto-increment primary key
- `timestamp` - Unix timestamp
- `content` - Summary text
- `source_event_id` - Link to originating event (for Call Summaries)

### variables table

- `key` - Primary key (string)
- `value` - JSON/Text value

### undone_events & undone_summaries tables

- Support undo/redo functionality
- Mirror structure of events and summaries tables

**Note**: Database uses WAL (Write-Ahead Logging) mode for better concurrent access performance.

---

## Usage Example

### In Runner

```ruby
class Runner
  def initialize(project_path)
    @state = State.new(project_path)
    @recorder = StateRecorder.new(@state)
  end

  def record_user_input(input)
    @last_user_event_id = @recorder.record_user(input)
  end

  def plan(goal, context)
    res = @planner.plan(context, goal)
    @recorder.record_plan(res)
    res
  end

  def run_call(call)
    res = @engine.execute(call["tool"], call["args"])
    @recorder.record_execution(call["tool"], res, call_seq: @last_user_event_id)
    res
  end
end
```

### In StateProvider

```ruby
class StateProvider
  def provide
    # get_recent_events_structured is private, accessed via send()
    items = @db.send(:get_recent_events_structured, phases: ["user", "plan", "execution"])
    
    items.each do |e|
      case e["phase"]
      when "user"
        # Display user message
      when "plan"
        # Prefer thought, then summary
        thought = e["payload"]["thought"]
        summary = e["payload"]["summary"]
        body = thought || summary || "Calling #{e['tool']}"
      when "execution"
        # Display tool result
      end
    end
  end
end
```

---

## Configuration Reference

### state_management (config.yml)

```yaml
state_management:
  max_state_chars: 100000           # Trigger metabolism at this char count
  recent_events_n: 20               # Keep this many recent events
  keep_last_summary_n_steps: 20     # Keep this many recent summaries
  
  summarization:
    enabled: true
    max_chars: 500                  # Max length for metabolism summaries
    model: "gpt-4o"                 # Optional: specific model for summaries
    focus_on:                       # Summary focus areas
      - "key_files_modified"
      - "critical_test_results"
      - "blockers_encountered"
      - "cumulative_result"
  
  retention:
    execution: { max_steps: 5, summarize: true }
    observe: { max_steps: 3, summarize: false }
    plan: { max_steps: 50, summarize: false }
    user: { max_steps: 100, summarize: false }
    learn: { max_steps: 200, summarize: true }
    interception: { max_steps: 100, summarize: false }
    milestone: { permanent: true }
```

### tool_protocol.call_summary (config.yml)

```yaml
tool_protocol:
  call_summary:
    suggested_chars: 120            # Suggested summary length for LLM
    max_chars: 256                  # Max summary length (truncate if exceeded)
```

---

## Design Advantages

### 1. Separation of Concerns

- **StateRecorder**: Focuses on write logic, ensures data consistency
- **StateProvider**: Focuses on read logic, optimizes display format
- **State**: Focuses on database operations and transaction management

### 2. Type Safety

```ruby
# Old way: Error-prone, inconsistent structure
@state.record_event({ phase: "plan", plan: res })
@state.record_event({ phase: "execution", tool: tool, result: res })

# New way: Structured interface, automatic validation
@recorder.record_plan(res)
@recorder.record_execution(tool, res, call_seq: id)
```

### 3. Testability

```ruby
# Can test Recorder and Provider independently
recorder = StateRecorder.new(mock_state)
recorder.record_plan({ tool: "test", args: {} })
assert_called_with(mock_state, :record_event, expected_payload)
```

### 4. Backward Compatibility

- State's底层 API (`record_event`) remains unchanged
- StateRecorder provides higher-level abstraction
- Existing code can migrate gradually

### 5. Extensibility

```ruby
# Easily add new event types
def record_custom_event(type, data)
  @recorder.record_custom(type, data)
end

# Batch operations with transaction support
@recorder.record_batch([
  { type: "user", content: "..." },
  { type: "plan", plan: {...} },
  { type: "execution", tool: "...", result: {...} }
])
```

---

## Migration Guide

If you're calling `@state.record_event` directly elsewhere, migrate to `@recorder`:

```ruby
# Before
@state.record_event({ phase: "plan", plan: result })
@state.record_event({ phase: "execution", tool: name, result: res })

# After
@recorder.record_plan(result)
@recorder.record_execution(name, res)
```

This makes code clearer, type-safe, and symmetric with StateProvider.

---

## Code References

- **StateRecorder**: `lib/aura/context/state_recorder.rb`
- **StateProvider**: `lib/aura/context/state_provider.rb`
- **State**: `lib/aura/kernel/state.rb`
- **Runner**: `lib/aura/kernel/runner.rb`
- **Tests**: `test/context/test_state_recorder.rb`

---

## See Also

- [Memory Management](memory-management.md) - Metabolism and retention
- [Session Architecture](session-architecture.md) - Session isolation
- [Architecture Overview](architecture.md) - System design
