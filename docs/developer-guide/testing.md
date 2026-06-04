# Testing & CI/CD

Guide for contributors to the Aura framework itself.

---

## Testing Strategy (TDD)

The tests under `test/` validate the framework code in this repository.

**Scope Confirmed:**
- CLI entry and dispatch: `bin/aura`, `lib/aura/cli.rb`, `lib/aura/cli/entry.rb`, `lib/aura/cli/command.rb`
- Workspace initializer: `lib/aura/cli/commands/new_command.rb` (creates `.aura/` by cloning the global repo)
- Templates: `lib/aura/generators/aura/app/templates/config.yml` and `lib/aura/generators/aura/app/templates/tools/read_file/` scaffold
- Many tests generate a temporary Agent project via `bin/aura new <tmp_path>` and assert files under that generated project

---

## Running Tests Locally

### Basic Commands

```bash
# Run all tests (default rake task)
rake

# Run tests only
rake test

# Run with coverage report
rake coverage
# Open coverage/index.html to view report

# Run specific test file
ruby test/integration/cli/test_cli_routing.rb
```

### Type-based Test Layers (unit / integration / system / eval)

The repository uses a **type-first** test structure:
- `test/unit/**`: fast, deterministic, no real network
- `test/integration/**`: multi-module integration, no real network
- `test/system/**`: end-to-end tests, may use real LLM / real network (opt-in)
- `test/eval/**`: evaluation harness/tests, may use real LLM judge (opt-in)

```bash
# Unit only
rake test:unit

# Integration only
rake test:integration

# Default "rake test" runs unit+integration only (excludes system/eval)
rake test

# System tests (opt-in; may make real network calls)
rake test:system

# Eval (opt-in; may make real network calls)
rake test:eval
```

Notes:
- `test:system` / `test:eval` are intended to run with real provider keys (e.g. `OPENROUTER_API_KEY`, `OPENAI_API_KEY`) and can be skipped/disabled in CI.

### 4) Terminal-Bench Eval Harness (Evaluating Aura Agent)

Aura integrates with the `terminal-bench` CLI to evaluate the Aura agent on standard terminal benchmarks. The custom Python adapter class `AuraAgent` and installer script are located under `test/eval/`.

#### Quick Start

Run the default benchmark task (`hello-world` using the default pre-release dataset and Claude Sonnet 4):
```bash
bundle exec rake test:eval:aura
```

#### Customizing the Evaluation

The Rake task accepts positional arguments for custom configurations in the format:
```bash
bundle exec rake test:eval:aura[task_id,dataset,model]
```

*   **`task_id`**: The specific task ID to run (defaults to `hello-world`).
*   **`dataset`**: The dataset name and version (defaults to `terminal-bench-core==head`. If there are branch/tag mapping issues, use `terminal-bench-core==0.1.1` as a stable fallback).
*   **`model`**: The provider and model identifier (defaults to `anthropic/claude-sonnet-4-20250514`).

For example, to run the `blind-maze-explorer-5x5` task using the stable dataset:
```bash
bundle exec rake test:eval:aura[blind-maze-explorer-5x5,terminal-bench-core==0.1.1]
```

Alternatively, you can configure these parameters directly in your workspace `.env` file, and they will be automatically loaded at startup:
```env
TB_MODEL=anthropic/claude-3-5-sonnet-20241022
TB_DATASET=terminal-bench-core==0.1.1
TB_TASK_ID=hello-world
```
If these are defined in `.env`, you can simply run `bundle exec rake test:eval:aura` and it will automatically apply those configurations.

#### Running Full Evaluations & Getting Scores

If you want to evaluate the Aura agent against an entire dataset (all tasks) and calculate a final score, you can run the `test:eval:benchmark` Rake task:

```bash
# Run the entire dataset (defaults to terminal-bench-core==0.1.1)
bundle exec rake "test:eval:benchmark"
```

You can pass positional arguments to customize the dataset, model, and the number of tasks:
```bash
bundle exec rake "test:eval:benchmark[dataset,model,n_tasks]"
```

For example, to run only the first 5 tasks of `terminal-bench-core==0.1.1`:
```bash
bundle exec rake "test:eval:benchmark[terminal-bench-core==0.1.1,,5]"
```

At the end of the execution, `terminal-bench` will output a summary table containing metrics (Resolved Trials, Unresolved Trials, and Accuracy Percentage) along with a link to the `results.json` log.

> [!IMPORTANT]
> **Docker Requirements**: Since `terminal-bench` runs task environments inside sandboxed containers, Docker Desktop must be running on your local machine to launch evaluations.

#### The Aura Python SDK


Aura provides a first-class Python SDK to programmatically control the Aura workspace, agent run loop, and configurations. See [sdk.md](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/docs/developer-guide/sdk.md) for full documentation.

*   **`AuraClient`**: The core class defined in [client.py](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/sdk/python/aura_sdk/client.py).
    *   `initialize()` / `get_initialize_command()`: Initializes a new workspace (equivalent to `aura new .`).
    *   `run_loop(goal)` / `get_run_loop_command(goal)`: Starts the developer loop to execute a goal (`aura kernel loop`).
    *   `update_config(provider, model)` / `get_config_update_command(provider, model)`: Rewrites `.aura/config/config.yml` with the target LLM configuration.

During evaluation, [test_terminal_bench_cli.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/test/eval/test_terminal_bench_cli.rb) appends the [sdk/python/](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/sdk/python/) directory to the Python search path (`PYTHONPATH`), allowing the `AuraAgent` Python adapter inside [aura_agent.py](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/test/eval/aura_agent.py) to import `AuraClient` seamlessly.

#### Under the Hood

The evaluation process does the following:
1.  **Packages Aura Gem**: Auto-builds the Aura framework on the host (`gem build aura.gemspec`).
2.  **Sets Up Task Container**: Launches a Docker container via `terminal-bench`, copies the `.gem` package and `test/eval/aura_setup.sh` installer, installs Ruby/SQLite dependencies, and registers the Aura gem.
3.  **Configures Workspace**: Instantiates `AuraClient`, runs `aura new` in-place inside the container workspace, and updates `.aura/config/config.yml` to route to the target provider/model.
4.  **Runs Solver Loop**: Invokes `AuraClient.get_run_loop_command` to execute `aura kernel loop --goal` and autonomously solve the benchmark task.

### Install Dependencies

```bash
bundle install
```

---

## Test Matrix

### 1) CLI Routing & Help Mappings

**Goal**: Ensure `Aura::CLI::EntryPoint.start` routes `help` to `ApplicationCommand`.

```ruby
# test/integration/cli/test_cli_routing.rb
require "minitest/autorun"
require "aura/cli/entry"

class TestCliRouting < Minitest::Test
  def test_help_routes_to_application
    called = false
    require "aura/cli/commands/application_command"
    klass = Aura::Commands::ApplicationCommand
    def klass.start(*); $called = true; end

    Aura::CLI::EntryPoint.start(["help"])
    assert $called, "CLI did not dispatch to ApplicationCommand"
  end
end
```

### 2) Command Invocation Fallback

**Goal**: Unknown command prints an informative message.

```ruby
# test/integration/cli/test_command_fallback.rb
require "minitest/autorun"
require "stringio"
require "aura/cli/command"

class TestCommandFallback < Minitest::Test
  def test_unknown_command_message
    out = StringIO.new
    $stdout = out
    Aura::Command.invoke(:nonexistent, [])
    $stdout = STDOUT
    assert_includes out.string, "Unknown command"
  end
end
```

### 3) Application Generator: Scaffold Structure

**Goal**: `bin/aura new <APP_PATH>` creates expected directories and files.

```ruby
# test/integration/generators/test_generator_scaffold.rb
require "minitest/autorun"
require "fileutils"

class TestGeneratorScaffold < Minitest::Test
  def setup
    @root = Dir.pwd
    @app  = File.join(@root, "tmp_app")
    system("ruby", File.join(@root, "bin", "aura"), "new", @app)
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_scaffold_created
    hidden = File.join(@app, ".aura")
    assert File.exist?(File.join(hidden, "config", "config.yml"))
    %w[logic.py manifest.json logic.py.hint].each do |f|
      assert File.exist?(File.join(hidden, "tools", "read_file", f))
    end
  end
end
```

### 4) Config Template Schema

**Goal**: `config.yml` contains expected sections and fields.

```ruby
# test/integration/config/test_config_schema.rb
require "minitest/autorun"
require "yaml"

class TestConfigSchema < Minitest::Test
  def test_config_keys
    path = File.expand_path("../../lib/aura/generators/aura/app/templates/config.yml", __dir__)
    data = YAML.load_file(path)
    %w[system state_management tool_protocol security hints].each do |k|
      assert data.key?(k), "missing #{k}"
    end
    assert data["state_management"]["max_state_chars"].is_a?(Integer)
    %w[python ruby shell].each do |rt|
      assert data["tool_protocol"]["runtimes"].key?(rt)
    end
  end
end
```

---

## CI/CD Workflow

### GitHub Actions Configuration

**File**: `.github/workflows/ci.yml`

**Triggered On:**
- Push to `main` or `master` branch
- Pull requests to `main` or `master`

### Jobs Structure

```
┌─────────────────────────────────────┐
│         CI Workflow Starts          │
└─────────────────────────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────┐
│  Test  │ │ Build Gem│
│(4 Rubies)│ │ (1 Job)  │
└────────┘ └──────────┘
    │
    ▼
┌──────────┐
│ Coverage │
│(1 Job)   │
└──────────┘
    │
    ▼
┌──────────┐
│ RuboCop  │
│(Non-block)│
└──────────┘
```

### Test Matrix

Runs in parallel on Ubuntu:
- Ruby 3.0 + SQLite3
- Ruby 3.1 + SQLite3
- Ruby 3.2 + SQLite3
- Ruby 3.3 + SQLite3

### Jobs

1. **test**: Multi-Ruby version test matrix
2. **coverage**: Code coverage analysis
3. **build-gem**: Gem packaging validation
4. **lint**: RuboCop style checks (non-blocking)

### Artifacts Uploaded

- Test results (per Ruby version)
- Coverage report (HTML)
- Built gem file
- RuboCop report

---

## Code Coverage (SimpleCov)

### Setup

**File**: `test/test_helper.rb`

SimpleCov is integrated and only runs when `COVERAGE=true`:

```ruby
# test/test_helper.rb
if ENV["COVERAGE"]
  require "simplecov"
  SimpleCov.start do
    minimum_coverage 0  # Increase to 80% when ready
  end
end
```

### Running with Coverage

```bash
rake coverage
# Opens coverage/index.html
```

### Increase Coverage Requirements

```ruby
# In test/test_helper.rb
minimum_coverage 80  # Enforce 80% coverage
```

---

## RuboCop Configuration

### Configuration File

**File**: `.rubocop.yml`

**Relaxed Settings for Initial Integration:**
- Line length: 150 chars (vs default 120)
- Method length: 50 lines (vs default 10)
- Excludes: test/, vendor/, .aura/
- Allows Chinese comments

### Running RuboCop

```bash
# Check style
bundle exec rubocop

# Auto-fix safe violations
bundle exec rubocop -A

# Check specific file
bundle exec rubocop lib/aura/kernel/state.rb

# Check specific rule
bundle exec rubocop --only Layout/LineLength
```

### Make RuboCop Blocking

In `.github/workflows/ci.yml`, remove:
```yaml
continue-on-error: true  # Remove this line
```

### Stricter Rules

```yaml
# In .rubocop.yml
Metrics/MethodLength:
  Max: 25  # Was 50

Layout/LineLength:
  Max: 120  # Was 150
```

---

## Gem Build and Publishing

### Build Gem Locally

```bash
rake build
# Outputs: aura-0.1.0.gem
```

### Manual Release

```bash
# 1. Update version in aura.gemspec
spec.version = "0.1.1"

# 2. Commit changes
git commit -am "Bump version to 0.1.1"

# 3. Build gem
rake build

# 4. Sign in to RubyGems (one-time)
gem signin

# 5. Push to RubyGems
gem push aura-0.1.1.gem
```

### Automated Release (Future)

Add to `.github/workflows/release.yml`:

```yaml
on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ruby/setup-ruby@v1
      - run: gem build aura.gemspec
      - uses: rubygems/release-gem@v1
        with:
          api-key: ${{ secrets.RUBYGEMS_API_KEY }}
```

Then release with:
```bash
git tag v0.1.1
git push origin v0.1.1
```

---

## Troubleshooting

### Tests Pass Locally but Fail in CI

- Check Ruby version differences: `ruby -v`
- Ensure all dependencies in Gemfile
- CI uses Ubuntu, not macOS

### Gem Build Fails

- Verify `spec.files` includes all needed files
- Check file paths are correct
- Run `gem build aura.gemspec` locally first

### Coverage Report Missing

- Ensure `COVERAGE=true` env var is set
- Check SimpleCov is in Gemfile
- Run `rake coverage` not just `rake test`

### RuboCop Too Many Errors

- Start with relaxed `.rubocop.yml` (current setup)
- Use `bundle exec rubocop -A` to auto-fix
- Add problematic files to exclude list

---

## Pending Test Coverage

- Context TTL & lifecycle: richer test coverage for context maintenance and expiry behavior
- Security policy enforcement: additional Kernel-level gates (e.g., `self_edit`), and broader coverage for strict path isolation edge cases
- Runtime wrapper: expanded cross-runtime tests for interpreter routing and sandbox providers

---

## CI/CD Resources

### GitHub Actions Usage

- **Free tier**: 2,000 minutes/month for public repos
- **Estimated usage**: ~10-15 minutes per CI run
- **Parallel jobs**: 4 test jobs + coverage + gem + lint = 7 jobs

### Storage

- Artifacts retained for 30 days
- Estimated: ~50MB per CI run
- Well within GitHub's free limits

---

## Quick Reference

### Common Commands

```bash
# Run tests
rake

# Run with coverage
rake coverage

# Build gem
rake build

# Check code style
bundle exec rubocop

# Auto-fix style issues
bundle exec rubocop -A

# Check specific rule
bundle exec rubocop --only Layout/LineLength
```

### Configuration Files

- **Workflow**: `.github/workflows/ci.yml`
- **Style config**: `.rubocop.yml`
- **Coverage config**: `test/test_helper.rb` (lines 3-16)
- **Build tasks**: `Rakefile`

---

## Code References

- **Tests**: `test/`
- **CI Workflow**: `.github/workflows/ci.yml`
- **Rakefile**: `Rakefile`
- **RuboCop Config**: `.rubocop.yml`

---

## See Also

- [Architecture Overview](architecture.md) - System design
- [Kernel Documentation](kernel.md) - Core execution engine
- [Context & State](context-and-state.md) - State management
