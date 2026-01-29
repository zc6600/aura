# Context Engine Guide

## Purpose
- Provide an extensible semantic context layer that aggregates system rules, tool capabilities, metabolized memory, and knowledge index for Aura projects.
- Follow the Single Responsibility Principle: each semantic asset is handled by a dedicated Provider; `Base` only orchestrates and concatenates outputs.

## Layout
```
lib/aura/context/
├── base.rb               # Orchestrator that concatenates Provider outputs
├── system_provider.rb    # Reads AURA_README.md and system rules
├── tool_provider.rb      # Scans tools/*, reads manifest.json and *.hint
├── state_provider.rb     # Pulls summary/variables/recent from a DB adapter
├── knowledge_provider.rb # Indexes files under knowledge/*
└── ../context.rb         # Public entry (API)
```

## Usage
- Entry API:
```ruby
require "aura/context"
output = Aura::Context.assemble("/path/to/project", db)
puts output
```
- Parameters:
  - `project_path`: project root containing `tools/`, `knowledge/`, optional `AURA_README.md`
  - `db`: optional DB adapter used by `StateProvider`; omit to skip state section

## DB Adapter (minimal)
- Implement the following methods to be consumed by `StateProvider`:
```ruby
class DbAdapter
  def get_latest_summary; "Long-term summary"; end
  def get_active_variables; { "goal" => "build" }; end
  def get_recent_events; "recent events"; end
end
```
- Methods may return `nil`/empty collections; `StateProvider` skips empty outputs.

## Providers
- `SystemProvider`:
  - Reads `AURA_README.md` at project root and injects as system context.
- `ToolProvider`:
  - Scans `tools/*`, parses `manifest.json` (name/description/permissions), loads the first `*.hint` for guidance.
  - Gracefully handles malformed `manifest.json` (treated as empty).
- `StateProvider`:
  - Consumes the `db` adapter and assembles `Historical Summary` / `Active Variables` / `Recent Activity Trace`.
- `KnowledgeProvider`:
  - Recursively scans `knowledge/` and emits relative path index for discoverability.

## Extend (add a Provider)
- Create `lib/aura/context/<your_provider>.rb` with a `provide` method returning a string fragment.
- Add your Provider to `@providers` in `base.rb`:
```ruby
@providers = [
  SystemProvider.new(project_path),
  ToolProvider.new(project_path),
  StateProvider.new(db),
  KnowledgeProvider.new(project_path),
  SensorProvider.new(project_path) # example
]
```

## Concurrency (optional)
- For large projects, run Providers concurrently and then join in deterministic order:
```ruby
results = []
threads = @providers.map { |p| Thread.new { results << [p.class.name, p.provide] } }
threads.each(&:join)
ordered = @providers.map { |p| results.find { |r| r[0] == p.class.name }&.last }
ordered.compact.join("\n\n")
```
- Note: Providers are read-only; concurrent reads are safe.

## Policy
- Decide which Providers to load based on agent role (e.g., skip `StateProvider` for guest mode).
- `ToolProvider` reads metadata and hints only; execution and sandboxing are handled elsewhere.

## Dependencies
- Ruby standard library only (`json`, etc.); zero external dependencies.

## Testing
- Integration sample: `test/context/test_context_base.rb`.
- Run all tests:
```
ruby -Ilib -e 'Dir["test/**/*.rb"].each { |f| load f }'
```

## FAQ
- No `db` provided: `StateProvider` is skipped; other sections still render.
- Missing or broken `manifest.json`: treated as empty; `*.hint` is preserved when present.
