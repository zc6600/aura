# Context Refactoring Manual: Prompt, EnvProvider, & Memory Alignment

This manual serves as the technical guide for refactoring the context layer (`lib/aura/context/`) to align with our updated 3区分心智模型 (Prompt, EnvProvider, & Memory), placing `Task` under Prompt, and wrapping environment facts inside `EnvProvider`.

---

## 1. Concepts & Structural Mapping

The refactoring will map the current flat `sections` keys to the new domain boundary structures:

```
┌─────────────────┬────────────────────────────────────────────────────────┐
│ Conceptual Area │ Context Provider / Content Source                      │
├─────────────────┼────────────────────────────────────────────────────────┤
│ 1. Prompt       │                                                        │
│ ├─ Kernel       │ DirectiveProvider (:directive)                         │
│ ├─ Workspace    │ MarkdownWorkspaceProvider (:workspace)                 │
│ └─ Task         │ TaskProvider (:task)                                   │
├─────────────────┼────────────────────────────────────────────────────────┤
│ 2. EnvProvider  │                                                        │
│ ├─ Overview/Tags│ EnvironmentProvider (:env)                             │
│ ├─ Diagnostics  │ LSPProvider (:lsp)                                     │
│ └─ Knowledge    │ KnowledgeProvider (:knowledge)                         │
├─────────────────┼────────────────────────────────────────────────────────┤
│ 3. Memory       │                                                        │
│ └─ State        │ StateProvider (:state)                                 │
└─────────────────┴────────────────────────────────────────────────────────┘
```

*Note: Tool headers (:active and :index) remain available for raw markdown fallback serialization but are otherwise decoupled from prompt messages.*

---

## 2. API Design & Class Interfaces

### A. `Aura::Context::Prompt` (`lib/aura/context/prompt.rb`)
Encapsulates all rule-based directive blocks and checklist goals:
```ruby
module Aura
  module Context
    class Prompt
      attr_reader :kernel_prompt, :workspace_prompt, :task_prompt

      def initialize(kernel_prompt, workspace_prompt, task_prompt)
        @kernel_prompt = kernel_prompt.to_s.strip
        @workspace_prompt = workspace_prompt.to_s.strip
        @task_prompt = task_prompt.to_s.strip
      end

      # Merges the prompts sequentially
      def to_markdown
        [
          @kernel_prompt,
          @workspace_prompt,
          @task_prompt
        ].reject(&:empty?).join("\n\n")
      end
      alias to_s to_markdown
      alias to_str to_markdown
    end
  end
end
```

### B. `Aura::Context::EnvProvider` (`lib/aura/context/env_provider.rb`)
Encapsulates files list, hint tags, LSP diagnostics, and persistent facts:
```ruby
module Aura
  module Context
    class EnvProvider
      attr_reader :overview, :lsp, :knowledge

      def initialize(overview:, lsp:, knowledge:)
        @overview = overview.to_s.strip
        @lsp = lsp.to_s.strip
        @knowledge = knowledge.to_s.strip
      end

      # Serializes all environment blocks sequentially
      def to_markdown
        [
          @overview,
          @lsp,
          @knowledge
        ].reject(&:empty?).join("\n\n")
      end
      alias to_s to_markdown
      alias to_str to_markdown
    end
  end
end
```

### C. `Aura::Context::Memory` (`lib/aura/context/memory.rb`)
Encapsulates SQLite session history and active variables:
```ruby
module Aura
  module Context
    class Memory
      attr_reader :state

      def initialize(state:)
        @state = state.to_s.strip
      end

      # Serializes state events sequentially
      def to_markdown
        @state
      end
      alias to_s to_markdown
      alias to_str to_markdown
    end
  end
end
```

### D. `Aura::Context::Payload` Refactoring (`lib/aura/context/payload.rb`)
To preserve backward compatibility with all tests and internal callers, `Payload` will internally store the original `sections` hash but expose `prompt`, `env_provider`, and `memory` structures:

```ruby
module Aura
  module Context
    class Payload
      attr_reader :prompt, :env_provider, :memory, :tools, :sections

      # New Signature
      def initialize(prompt, env_provider, memory, tools = [], options = {}, sections = {})
        @prompt = prompt
        @env_provider = env_provider
        @memory = memory
        @tools = tools || []
        @options = options || {}
        # Keep sections hash for backward compatibility (e.g. to_markdown_excluding)
        @sections = sections || {}
      end

      # to_messages serialization using Prompt, EnvProvider & Memory structures
      def to_messages(goal: nil)
        mode = @options[:directive_mode]
        if mode == :ralph_developer || mode == :ralph_critic
          system_prompt = @prompt.kernel_prompt # For loop protocols
          user_content = build_user_content(goal)
          [
            { role: "system", content: system_prompt },
            { role: "user", content: user_content }
          ]
        else
          user_content = build_user_content(goal)
          return [] if user_content.nil? || user_content.empty?

          [{ role: "user", content: user_content }]
        end
      end
      
      # build_user_content delegates dynamically to options, EnvProvider, and Memory blocks
      # ...
    end
  end
end
```

### E. `Aura::Context::Base` Refactoring (`lib/aura/context/base.rb`)
`Base#assemble` handles the builder steps:
1. Gathers flat section strings and runs compression checks as before.
2. Extracts specific section strings into `Prompt`, `EnvProvider`, and `Memory`.
3. Instantiates and returns `Aura::Context::Payload`.

```ruby
      def assemble
        content = @providers.map(&:provide).compact.join("\n\n")
        limit = fetch_max_chars(@project_path)
        final_content = if limit&.to_i&.positive? && content.length > limit
                          compress_content(content, limit)
                        else
                          content
                        end

        tool_provider = @providers.find { |p| p.is_a?(ToolProvider) }
        tools = tool_provider ? tool_provider.provide_structured : []

        sections = split_sections(final_content)

        # Build new structures
        prompt = Aura::Context::Prompt.new(
          sections[:directive],
          sections[:workspace],
          sections[:task]
        )

        env_provider = Aura::Context::EnvProvider.new(
          overview: sections[:env],
          lsp: sections[:lsp],
          knowledge: sections[:knowledge]
        )

        memory = Aura::Context::Memory.new(
          state: sections[:state]
        )

        Aura::Context::Payload.new(prompt, env_provider, memory, tools, @options, sections)
      end
```

---

## 3. Step-by-Step Refactoring Workflow

- [ ] **Step 1**: Write/modify files `lib/aura/context/prompt.rb`, `lib/aura/context/env_provider.rb`, and `lib/aura/context/memory.rb`.
- [ ] **Step 2**: Edit `lib/aura/context/payload.rb` to update the constructor signature, keep `@sections` compatibility, and adapt `to_messages` to read from `@prompt`, `@env_provider`, and `@memory`.
- [ ] **Step 3**: Edit `lib/aura/context/base.rb` to instantiate `Prompt`, `EnvProvider`, and `Memory` and pass them to the new `Payload` constructor.
- [ ] **Step 4**: Run the tests to ensure that everything is 100% compatible.
- [ ] **Step 5**: Write specific unit tests for `Prompt`, `EnvProvider`, and `Memory` model verification.
