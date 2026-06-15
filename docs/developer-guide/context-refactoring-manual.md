# Context Architecture Manual: Prompt, EnvProvider, & Memory Alignment

This manual serves as the technical guide for the context layer (`src/core/context/`) to align with our 3区分 mind model (Prompt, EnvProvider, & Memory), placing `Task` under Prompt, wrapping environment facts inside `EnvProvider`, and managing state under `Memory`.

---

## 1. Concepts & Structural Mapping

The context builder maps various provider sections to the domain boundary structures:

| Conceptual Area | Context Provider / Content Source |
| :--- | :--- |
| **1. Prompt** | |
| ├─ Kernel | `DirectiveProvider` (`sections.directive`) |
| ├─ Workspace | `WorkspaceProvider` (`sections.workspace`) |
| └─ Task | `TaskProvider` (`sections.task`) |
| **2. EnvProvider** | |
| ├─ Overview/Tags | Combined sub-providers (`sections.env` constructed via `ContextBase.buildEnvironmentContent()` combining `GlobalRulesProvider`, `DirectoryTreeProvider`, `HintProvider`, `SkillProvider`, `GardenProvider`, `AnchorProvider`, and `BackgroundProcessProvider`) |
| ├─ Diagnostics | `LSPProvider` (`sections.lsp`) |
| └─ Knowledge | `KnowledgeProvider` (`sections.knowledge`) |
| **3. Memory** | |
| └─ State | `StateProvider` (`sections.state` summarizing SQLite session history) |
| **4. Tools** | |
| └─ Active Tools | `ToolProvider` (`sections.tools` exposing local and MCP tools) |

*Note: Tool schemas (`tools`) are managed separately for native tool calling and decoupled from prompt messages in modern API usage, but are also serialized to the `sections.tools` text payload for fallback/compatibility.*

---

## 2. API Design & Class Interfaces

All context domain classes are located in [payload.ts](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/src/core/context/payload.ts) and assembled in [base.ts](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/src/core/context/base.ts).

### A. `ContextPrompt`

Encapsulates all rule-based directive blocks and checklist goals:

```typescript
export class ContextPrompt {
  constructor(
    public readonly kernel_prompt: string,
    public readonly workspace_prompt: string,
    public readonly task_prompt: string,
  ) {}
}
```

### B. `ContextEnvProvider`

Encapsulates files list, hint tags, LSP diagnostics, and persistent facts:

```typescript
export class ContextEnvProvider {
  constructor(
    public readonly overview: string,
    public readonly lsp: string,
    public readonly knowledge: string,
  ) {}
}
```

### C. `ContextMemory`

Encapsulates SQLite session history and active variables:

```typescript
export class ContextMemory {
  constructor(public readonly state: string) {}
}
```

### D. `ContextPayload`

Coordinates the serialization of these elements into messages for the LLM client, supporting various loop protocols (e.g. Ralph autonomous developer/critic mode):

```typescript
export class ContextPayload {
  public readonly prompt?: ContextPrompt | null;
  public readonly env_provider?: ContextEnvProvider | null;
  public readonly memory?: ContextMemory | null;
  public readonly tools: StructuredTool[];
  public readonly options: Record<string, unknown>;
  public readonly sections: Record<string, string>;

  constructor(
    promptOrSections: ContextPrompt | Record<string, string>,
    envProviderOrTools: ContextEnvProvider | StructuredTool[] = [],
    memoryOrOptions: ContextMemory | Record<string, unknown> = {},
    tools: StructuredTool[] = [],
    options: Record<string, unknown> = {},
    sections: Record<string, string> = {},
  ) {
    // Supports robust polymorphic initialization for backward compatibility:
    // Distinguishes Signature 1: (sections, tools, options) vs Signature 2: (prompt, env_provider, memory, tools, options, sections)
    // by checking if envProviderOrTools is an Array (StructuredTool[]) or checking object types.
    ...
  }

  // Serializes payload to flat Markdown string
  public toMarkdown(): string { ... }

  // Converts payload into ChatMessage list for the LLM
  public toMessages(options: { goal?: string | null } = {}): ChatMessage[] { ... }
}
```

### E. `ContextBase`

Handles the builder steps, gathering flat section strings, performing context compression/truncation as configured, and returning a `ContextPayload`:

```typescript
export class ContextBase {
  ...
  public assemble(): ContextPayload {
    const rawSections: Record<string, string> = {
      directive: this.directiveProvider.provide(),
      workspace: this.workspaceProvider.provide() || '',
      task: this.taskProvider.provide() || '',
      env: this.buildEnvironmentContent() || '',
      lsp: this.lspProvider.provide() || '',
      knowledge: this.knowledgeProvider.provide() || '',
      state: this.stateProvider.provide() || '',
      tools: this.toolProvider.provide() || '',
    };

    // Compress if context exceeds limits
    ...

    const tools = this.toolProvider.provide_structured();

    const prompt = new ContextPrompt(
      sections.directive || '',
      sections.workspace || '',
      sections.task || '',
    );

    const envProvider = new ContextEnvProvider(
      sections.env || '',
      sections.lsp || '',
      sections.knowledge || '',
    );

    const memory = new ContextMemory(sections.state || '');

    return new ContextPayload(
      prompt,
      envProvider,
      memory,
      tools,
      this.options,
      sections,
    );
  }
}

---

## 3. Context Compression & Section Discarding

If the compiled context length exceeds the `max_state_chars` limit (from `config.yml`), the system applies multi-tiered compression strategies (e.g. event payload truncation and history trimming). If the context is still too large, optional sections are discarded one by one in the following drop order priority:
1. `lsp` (LSP Diagnostics logs)
2. `env` (Environment Overview, including global rules and workspace directory tree)
3. `tools` (Active Tools Markdown lists)
```
