# Testing Strategy (TDD)

This document defines a Test-Driven Development plan for the Aura framework itself (CLI, command routing, generators, templates, and config). Tool-level tests are out-of-scope here.

## Scope Confirmed (Implemented)

- CLI entry and dispatch: `bin/aura`, `lib/aura/cli.rb`, `lib/aura/command.rb`.
- App generator and builder: `lib/aura/generators/aura/app/app_generator.rb`.
- Templates: `config.yml` and `tools/read_file/` directory scaffold.
- Documentation aligned to English (Architecture, State, Security, Tool Protocol).

## Test Matrix (Framework)

### 1) CLI Routing & Help Mappings

- Goal: Ensure `Aura::CLI.start` routes `help` to `ApplicationCommand`.
- Steps:
  - Invoke: `ruby -e 'require "aura/cli"; Aura::CLI.start(["help"])'`
  - Assert: `ApplicationCommand` is started with `help` args.
- Ruby minitest skeleton:

```ruby
# test/test_cli_routing.rb
require "minitest/autorun"
require "aura/cli"

class TestCliRouting < Minitest::Test
  def test_help_routes_to_application
    # Spy on ApplicationCommand.start
    called = false
    require "aura/commands/application_command"
    klass = Aura::Commands::ApplicationCommand
    def klass.start(*); $called = true; end

    Aura::CLI.start(["help"]) # triggers ApplicationCommand.start
    assert $called, "CLI did not dispatch to ApplicationCommand"
  end
end
```

### 2) Command Invocation Fallback

- Goal: Unknown command prints an informative message.
- Steps:
  - Invoke: `Aura::Command.invoke(:nonexistent, [])`
  - Assert: STDOUT contains `Unknown command`
- Skeleton:

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

- Goal: `bin/aura application new <APP_PATH>` creates expected directories and files.
- Steps:
  - Execute: `bin/aura new tmp_app`
  - Assert filesystem:
    - `tmp_app/config/config.yml`
    - `tmp_app/tools/read_file/{logic.py, manifest.json, test.py, logic.py.hint}`
  - Cleanup: remove `tmp_app`
- Skeleton:

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

### 4) Generator Options: `pretend` and `force`

- Goal: `pretend` performs no write; `force` overwrites without prompts.
- Steps:
  - Pretend:
    - Run: `bin/aura application new tmp_app -p`
    - Assert: `tmp_app/` does not exist
  - Force:
    - Create: `tmp_app/` with a conflicting file
    - Run: `bin/aura application new tmp_app -f`
    - Assert: conflicting file replaced by template
- Skeleton:

```ruby
# test/test_generator_options.rb
require "minitest/autorun"
require "fileutils"

class TestGeneratorOptions < Minitest::Test
  def test_pretend_skips_writes
    FileUtils.rm_rf("tmp_app")
    system("ruby bin/aura new tmp_app -p")
    refute Dir.exist?("tmp_app"), "pretend should not create files"
  end

  def test_force_overwrites_files
    FileUtils.mkdir_p("tmp_app/config")
    File.write("tmp_app/config/config.yml", "custom")
    system("ruby bin/aura new tmp_app -f")
    content = File.read("tmp_app/config/config.yml")
    refute_equal "custom", content
  ensure
    FileUtils.rm_rf("tmp_app")
  end
end
```

### 5) Config Template Schema (Framework-Level)

- Goal: `config.yml` contains expected sections and fields.
- Assertions:
  - Keys: `system`, `state_management`, `tool_protocol`, `security`, `hints`
  - `state_management.max_state_chars` is integer
  - `tool_protocol.runtimes.python`, `ruby`, `shell` are present
- Skeleton:

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

## Integration (Framework E2E)

### 6) End-to-End: Generate App

- Steps:
  1. `bin/aura new e2e_app`
  2. Assert scaffold structure as in test (3)
  3. Cleanup `e2e_app`

## Pending (Write Failing Framework Tests First)

- Kernel watcher daemon: filesystem events, debounce/merge, directory/file locks, crash recovery scan.
- State metabolism scheduler: character counting, summarization trigger, transactional persistence.
- Hint system: `.hint` scanning, caching by hash/timestamp, context injection and navigation map rendering.
- Permissions enforcement: `self_edit: false` and path isolation guard at framework level.
- Runtime wrapper: interpreter routing by `manifest.runtime` and extension, error piping and structured feedback via `Open3`.

Document and commit failing tests for these items before implementation.

## Running Tests (Ruby)

- Organize tests under subdirectories, e.g. `test/cli`, `test/generators`, `test/config`.
- Run all tests recursively: `ruby -Ilib -e 'Dir["test/**/*.rb"].each { |f| load f }'`
- Consider using `rake test` once a `Rakefile` is introduced.

## CI Suggestions

- Use GitHub Actions to run Ruby tests on push.
- Cache Ruby gems and leverage matrix builds if adding cross-runtime checks.
