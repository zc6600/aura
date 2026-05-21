# Aura Framework Architecture

## Scope & Paths

This documentation describes the internal architecture of the **Aura Framework** (the Ruby gem code in this repository).
- **Framework Root**: The root of this repository (`/Users/frank/Desktop/Towards AGI/aura/aura`).
- **Generated Project**: The directory created by `aura new <project_name>`.
- **Docs Location**: All internal implementation docs are located in `docs/internals/`.

---

## 🏗️ Complete Architecture Overview

### High-Level System Architecture

```mermaid
graph TB
    subgraph "User Interface Layer"
        CLI[CLI Commands<br/>aura run/ask/session]
        Shell[Interactive Shell<br/>aura shell]
        Web[Web Interface<br/>Future]
    end
    
    subgraph "Application Layer"
        Bridge[Bridge<br/>Event Routing]
        AgentLoop[AgentLoop<br/>Plan-Execute Cycle]
        SessionMgr[SessionManager<br/>Session Isolation]
    end
    
    subgraph "Kernel Layer"
        Runner[Runner<br/>Orchestrator]
        Planner[Planner<br/>LLM Integration]
        Metabolizer[MemoryMetabolizer<br/>Event Lifecycle]
        Engine[ExecutionEngine<br/>Tool Runtime]
        Registry[ToolRegistry<br/>Tool Discovery]
    end
    
    subgraph "Context & State Layer"
        StateRecorder[StateRecorder<br/>Write Events]
        StateProvider[StateProvider<br/>Read Events]
        State[(SQLite State DB<br/>sessions/*.db)]
        ContextMgr[ContextManager<br/>Context Assembly]
    end
    
    subgraph "Infrastructure Layer"
        LSP[LSP Manager<br/>Code Intelligence]
        MCP[MCP Client<br/>External Tools]
        Hints[Hint System<br/>.hint files]
        Validator[ToolValidator<br/>Tool Verification]
    end
    
    subgraph "External Services"
        LLM[LLM APIs<br/>OpenRouter/OpenAI]
        FileSystem[File System<br/>Workspace]
        Sandbox[Sandbox<br/>Docker/Local]
    end
    
    CLI --> Bridge
    Shell --> Bridge
    Web --> Bridge
    
    Bridge --> AgentLoop
    Bridge --> SessionMgr
    
    AgentLoop --> Runner
    SessionMgr --> State
    
    Runner --> Planner
    Runner --> Metabolizer
    Runner --> Engine
    Runner --> StateRecorder
    
    Engine --> Registry
    Engine --> Validator
    Engine --> LSP
    Engine --> MCP
    
    Metabolizer --> StateProvider
    Metabolizer --> State
    
    StateRecorder --> State
    StateProvider --> State
    
    Runner --> ContextMgr
    ContextMgr --> Hints
    
    Planner --> LLM
    Engine --> FileSystem
    Engine --> Sandbox
    
    style CLI fill:#e1f5ff
    style Shell fill:#e1f5ff
    style Bridge fill:#fff3e1
    style AgentLoop fill:#fff3e1
    style Runner fill:#ffe1e1
    style State fill:#e1ffe1
```

---

### Agent Loop - Plan-Execute Cycle

```mermaid
sequenceDiagram
    participant User
    participant Bridge
    participant AgentLoop
    participant Runner
    participant Planner
    participant Engine
    participant Metabolizer
    participant State
    participant LLM
    
    User->>Bridge: Run mission
    Bridge->>AgentLoop: Start agent loop
    
    loop Each Turn
        AgentLoop->>Runner: observe()
        Runner->>Metabolizer: metabolize()
        Metabolizer->>State: Read old events
        Metabolizer->>Metabolizer: Apply retention policy
        alt Need metabolism
            Metabolizer->>State: Generate summary
            Metabolizer->>State: Delete old events
            Metabolizer-->>Bridge: Emit metabolism events
        end
        
        Runner->>State: Record observe event
        Runner->>State: Assemble context
        
        AgentLoop->>Runner: plan(goal, context)
        Runner->>Planner: plan(context)
        Planner->>LLM: Send context + goal
        LLM-->>Planner: Return plan JSON
        Planner-->>Runner: plan hash
        Runner->>StateRecorder: record_plan()
        Runner-->>AgentLoop: plan result
        
        AgentLoop->>Bridge: Emit plan event
        AgentLoop->>Runner: run_call(plan)
        Runner->>Engine: execute(tool, args)
        Engine->>Engine: Run tool logic
        Engine-->>Runner: tool result
        Runner->>StateRecorder: record_execution()
        
        alt Has summary
            Runner->>State: commit_summary()
        end
        
        Runner-->>AgentLoop: execution result
        AgentLoop->>Bridge: Emit tool result
    end
    
    AgentLoop->>Bridge: Final answer
    Bridge->>User: Display result
```

---

### Memory Metabolism System

```mermaid
graph LR
    subgraph "Retention Tiers"
        T1[Tier 1: Ephemeral<br/>execution, observe<br/>3-5 steps]
        T2[Tier 2: Working<br/>plan, user<br/>50 steps]
        T3[Tier 3: Insights<br/>learn, interception<br/>200 steps]
        T4[Tier 4: Permanent<br/>milestone<br/>Forever]
    end
    
    subgraph "Metabolism Process"
        Check{Check triggers}
        Select[Select old events]
        Apply[Apply retention policy]
        Summary[Generate summary<br/>NarrativeService]
        Delete[Delete old events]
        Notify[Emit events<br/>to Bridge]
    end
    
    subgraph "Configuration Sources"
        Manifest[Tool Manifest<br/>memory field]
        Config[config.yml<br/>state_management]
        Defaults[Code defaults<br/>DEFAULT_RETENTION]
    end
    
    Manifest -.->|Priority 1| Apply
    Config -.->|Priority 2| Apply
    Defaults -.->|Priority 3| Apply
    
    Check --> Select
    Select --> Apply
    Apply -->|summarize=true| Summary
    Apply -->|summarize=false| Delete
    Apply -->|permanent=true| T4
    Summary --> Delete
    Delete --> Notify
    
    T1 -.->|ephemeral| Summary
    T2 -.->|working| Delete
    T3 -.->|insights| Summary
    T4 -.->|permanent| Keep
    
    style T1 fill:#ffcccc
    style T2 fill:#ffffcc
    style T3 fill:#ccffcc
    style T4 fill:#ccccff
    style Summary fill:#ffe1cc
```

---

### Two Types of Summaries

```mermaid
graph TB
    subgraph "Call Summary"
        LLM1[LLM returns plan]
        Extract[Extract summary field]
        Commit1[commit_summary<br/>with call_seq]
        Store1[(summaries table)]
        
        LLM1 --> Extract
        Extract --> Commit1
        Commit1 --> Store1
    end
    
    subgraph "Metabolism Summary"
        Trigger[Metabolism triggered]
        Select[Select old events]
        Narrative[NarrativeService.synthesize]
        LLM2[LLM generates narrative]
        Commit2[commit_summary<br/>Metabolism: ...]
        Store2[(summaries table)]
        
        Trigger --> Select
        Select --> Narrative
        Narrative --> LLM2
        LLM2 --> Commit2
        Commit2 --> Store2
    end
    
    subgraph "StateProvider Reads"
        ReadEvents[Read recent events<br/>chronological order]
        ReadSummaries[Read recent summaries]
        Assemble[Assemble context<br/>for LLM]
        
        ReadEvents --> Assemble
        ReadSummaries --> Assemble
    end
    
    Store1 -.-> ReadSummaries
    Store2 -.-> ReadSummaries
    
    style LLM1 fill:#e1f5ff
    style LLM2 fill:#e1f5ff
    style Store1 fill:#e1ffe1
    style Store2 fill:#e1ffe1
    style Assemble fill:#fff3e1
```

---

### Session Isolation Architecture

```mermaid
graph TB
    subgraph "Application Layer"
        SessionAPI[SessionManager API<br/>create/switch/delete]
        ActiveSession[active_session.txt<br/>current session name]
    end
    
    subgraph "Environment Contract"
        ENV1[ENV AURA_SESSION_NAME<br/>session identifier]
        ENV2[ENV AURA_STATE_DB_PATH<br/>direct DB path]
    end
    
    subgraph "Session Databases"
        DB1[(default.db<br/>Default session)]
        DB2[(session_001.db<br/>Research session)]
        DB3[(session_002.db<br/>Coding session)]
    end
    
    subgraph "State Layer"
        State[State class<br/>SQLite wrapper]
        Tables[events, summaries<br/>variables tables]
    end
    
    SessionAPI --> ActiveSession
    ActiveSession --> ENV1
    ENV1 --> State
    ENV2 --> State
    State --> DB1
    State --> DB2
    State --> DB3
    State --> Tables
    
    style SessionAPI fill:#e1f5ff
    style ENV1 fill:#fff3e1
    style ENV2 fill:#fff3e1
    style DB1 fill:#e1ffe1
    style DB2 fill:#e1ffe1
    style DB3 fill:#e1ffe1
```

---

### Tool Execution Pipeline

```mermaid
flowchart TD
    Start[Tool Call Received] --> Validate{Validate tool}
    
    Validate -->|Not found| Error1[Error: Tool not found]
    Validate -->|Found| CheckPerms{Check permissions}
    
    CheckPerms -->|Path violation| Error2[Error: Permission denied]
    CheckPerms -->|OK| CheckTimeout{Check timeout}
    
    CheckTimeout -->|Exceeded| Timeout[Return pid on timeout]
    CheckTimeout -->|OK| RunTool[Execute tool logic]
    
    RunTool --> Capture{Capture output}
    Capture --> Success[Success result]
    Capture --> Failed[Failed result<br/>with stderr]
    
    Success --> Record[StateRecorder.record_execution]
    Failed --> Record
    
    Record --> Summary{Has summary?}
    Summary -->|Yes| Commit[commit_summary]
    Summary -->|No| Next
    
    Commit --> Next{Check context lifecycle}
    Next -->|creates_context| AddCtx[Add to ContextManager]
    Next -->|destroys_context| RemoveCtx[Remove from ContextManager]
    Next -->|requires_context| UpdateCtx[Update context activity]
    
    AddCtx --> Emit[Emit tool_result event]
    RemoveCtx --> Emit
    UpdateCtx --> Emit
    Next --> Emit
    
    Emit --> Return[Return result to AgentLoop]
    
    style Start fill:#e1f5ff
    style Error1 fill:#ffcccc
    style Error2 fill:#ffcccc
    style Success fill:#ccffcc
    style Failed fill:#ffcccc
    style Emit fill:#fff3e1
```

---

## Module Map

The framework documentation is organized by functional modules rather than implementation languages.

### 1. [Kernel & Execution](KERNEL.md)
The core runtime engine that orchestrates the agent's lifecycle.
- **Execution Engine**: `Aura::Kernel::Runner` lifecycle (Observe -> Plan -> Execute -> Learn).
- **Tool Protocol**: The "Evolution Loop", tool structure (`logic.py`, `manifest.json`), and validation gates.
- **Memory Retention**: Tool-level memory configuration in manifest.json.
- **Security**: Sandboxing, path isolation, and permission enforcement.
- **Code Reference**: `lib/aura/kernel/`, `lib/aura/cli.rb`.

### 2. [Context & State](CONTEXT.md)
How the agent maintains continuity and memory.
- **State Management**: SQLite schema (`state/sessions/*.db`), event logging, and key-value storage.
- **Read-Write Separation**: StateRecorder (write) vs StateProvider (read).
- **Memory Metabolism**: Tiered retention strategy with manifest-based configuration.
- **Two Summary Types**: Call Summary (from LLM) vs Metabolism Summary (from NarrativeService).
- **Context Assembly**: Building the prompt context from state and environment.
- **Code Reference**: `lib/aura/context/`, `lib/aura/kernel/state.rb`.

### 3. [Session Architecture](SESSION_ARCHITECTURE.md)
Session isolation and management.
- **One Session, One DB**: Each conversation has an isolated SQLite database.
- **Environment Contract**: `ENV["AURA_SESSION_NAME"]` decouples layers.
- **Session Lifecycle**: Create, switch, delete, duplicate, export, import.
- **CLI Integration**: `aura session` commands and `/session` slash command.
- **Code Reference**: `lib/aura/context/session_manager.rb`.

### 4. [Integrations & Protocols](INTEGRATIONS.md)
Interfaces with the external world.
- **Model Context Protocol (MCP)**: Client/Server architecture for connecting to external data sources.
- **Hint System (LSP-lite)**: `.hint` files and `@aura-hint` tags for efficient code sensing.
- **LSP Manager**: Language Server Protocol for code intelligence.
- **Code Reference**: `lib/aura/mcp/`, `lib/aura/extension/`, `lib/aura/ext/lsp/`.

### 5. [Framework Development](TESTING.md)
Guide for contributors to the Aura framework itself.
- **TDD Strategy**: How to run framework tests.
- **Test Matrix**: Coverage of CLI, Generators, Runtime logic, and Memory Retention.
- **Code Reference**: `test/`.

### 6. [Global CLI Setup & PATH Integration](SETUP_AND_CLI.md)
Details on packaging, one-click installation, and global binary resolution.
- **Setup Script**: `bin/setup.sh` automated lifecycle.
- **PATH Resolution**: Gem binaries and version manager shims (`Gem.bindir`).
- **Source Root Check**: Framework pollution protection rules in `entry.rb`.

---

## Key Design Principles

1. **Layered Architecture**: Clear separation between UI, Application, Kernel, Context, and Infrastructure layers
2. **Event-Driven**: All communication through EventBus for loose coupling
3. **Read-Write Separation**: StateRecorder (write) and StateProvider (read) for clean state management
4. **Session Isolation**: Each conversation has its own database for privacy and organization
5. **Tiered Memory**: Different event types have different retention strategies
6. **Configuration-Driven**: Behavior controlled by config.yml and manifest.json, not hardcoded
7. **Tool Evolution**: Tools can be created, validated, tested, and improved by the agent itself


