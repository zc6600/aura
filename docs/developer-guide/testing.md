# Testing & CI/CD

Guide for contributors to the Aura framework itself.

---

## Testing Strategy (TDD)

The tests under `test/` validate the framework code in this repository.

**Scope Confirmed:**
- CLI entry and dispatch: `bin/aura`, `lib/aura/cli.rb`, `lib/aura/command.rb`
- App generator and builder: `lib/aura/generators/aura/app/app_generator.rb`
- Templates: `config.yml` and `tools/read_file/` directory scaffold
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
ruby test/cli/test_cli_routing.rb
```

### Install Dependencies

```bash
bundle install
```

---

## Test Matrix

### 1) CLI Routing & Help Mappings

**Goal**: Ensure `Aura::CLI.start` routes `help` to `ApplicationCommand`.

```ruby
# test/test_cli_routing.rb
require "minitest/autorun"
require "aura/cli"

class TestCliRouting < Minitest::Test
  def test_help_routes_to_application
    called = false
    require "aura/commands/application_command"
    klass = Aura::Commands::ApplicationCommand
    def klass.start(*); $called = true; end

    Aura::CLI.start(["help"])
    assert $called, "CLI did not dispatch to ApplicationCommand"
  end
end
```

### 2) Command Invocation Fallback

**Goal**: Unknown command prints an informative message.

```ruby
# test/test_command_fallback.rb
require "minitest/autorun"
require "stringio"
require "aura/command"

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

**Goal**: `bin/aura application new <APP_PATH>` creates expected directories and files.

```ruby
# test/test_generator_scaffold.rb
require "minitest/autorun"
require "fileutils"

class TestGeneratorScaffold < Minitest::Test
  def setup
    @root = Dir.pwd
    @app  = File.join(@root, "tmp_app")
    system("ruby bin/aura new tmp_app")
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_scaffold_created
    assert File.exist?(File.join(@app, "config", "config.yml"))
    %w[logic.py manifest.json test.py logic.py.hint].each do |f|
      assert File.exist?(File.join(@app, "tools", "read_file", f))
    end
  end
end
```

### 4) Config Template Schema

**Goal**: `config.yml` contains expected sections and fields.

```ruby
# test/test_config_schema.rb
require "minitest/autorun"
require "yaml"

class TestConfigSchema < Minitest::Test
  def setup
    system("ruby bin/aura new tmp_app")
  end

  def teardown
    FileUtils.rm_rf("tmp_app")
  end

  def test_config_keys
    data = YAML.load_file("tmp_app/config/config.yml")
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
