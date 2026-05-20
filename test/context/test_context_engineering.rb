require "minitest/autorun"
require "fileutils"
require "stringio"
require "aura/context"

class DummyContextDb
  attr_accessor :variables, :summaries, :events

  def initialize
    @variables = {}
    @summaries = []
    @events = []
  end

  def get_latest_summary
    @summaries.last
  end

  def get_recent_summaries_structured
    @summaries.map.with_index { |s, idx| { id: idx, timestamp: Time.now.to_i, content: s } }
  end

  def get_active_variables
    @variables
  end

  def get_recent_events_structured(options = {})
    @events
  end
end

class TestContextEngineering < Minitest::Test
  def setup
    @project = File.join(Dir.pwd, "tmp_ctx_eng_project")
    FileUtils.rm_rf(@project)
    FileUtils.mkdir_p(@project)
    FileUtils.mkdir_p(File.join(@project, "config"))
    
    # Write a base config.yml
    File.write(File.join(@project, "config", "config.yml"), <<~YAML)
      state_management:
        max_state_chars: 50000
    YAML
  end

  def teardown
    FileUtils.rm_rf(@project)
  end

  def test_discard_order_preserves_directive_and_task
    # We will write a tiny max_state_chars to force compression/discarding
    File.write(File.join(@project, "config", "config.yml"), <<~YAML)
      state_management:
        max_state_chars: 1000
    YAML

    # Let's create an active skill (directive) and a task.md (task)
    ENV["AURA_ACTIVE_SKILL"] = "test_skill"
    FileUtils.mkdir_p(File.join(@project, "skills", "test_skill"))
    File.write(File.join(@project, "skills", "test_skill", "SKILL.md"), <<~MD)
      ---
      name: test_skill
      description: test
      ---
      # AURA OS OPERATING PROTOCOL
      CORE_AURA_DIRECTIVE_RULE
    MD

    File.write(File.join(@project, "task.md"), "URGENT_TASK_NAME")

    # Write a long AURA_README.md (which goes to workspace overview/env)
    File.write(File.join(@project, "AURA_README.md"), "A" * 5000)

    db = DummyContextDb.new
    out = Aura::Context.assemble(@project, db)

    # Directive and Task should be preserved because they are last in the drop order,
    # while the workspace overview/env (AURA_README) should be dropped to fit under 1000 limit
    assert_includes out, "CORE_AURA_DIRECTIVE_RULE"
    assert_includes out, "URGENT_TASK_NAME"
    refute_includes out, "A" * 5000
  ensure
    ENV.delete("AURA_ACTIVE_SKILL")
  end

  def test_magic_hint_scanning_skips_large_files
    # Create a small python file with a hint
    File.write(File.join(@project, "small.py"), "# @aura-hint: Valid Hint Here")
    # Create a large python file (>100KB) with a hint
    File.write(File.join(@project, "large.py"), "# @aura-hint: Large Hint Should Not Show\n" + ("#" * 110000))

    provider = Aura::Context::EnvironmentProvider.new(@project)
    out = provider.provide

    assert_includes out, "Valid Hint Here"
    refute_includes out, "Large Hint Should Not Show"
  end

  def test_magic_hint_scanning_truncates_and_warns_on_long_hints
    # Create a python file with an extremely long hint (>1000 chars)
    long_hint_content = "X" * 1200
    File.write(File.join(@project, "long_hint.py"), "# @aura-hint: #{long_hint_content}")

    provider = Aura::Context::EnvironmentProvider.new(@project)

    # Capture stderr to verify warning output for default 1000 characters limit
    old_stderr = $stderr
    $stderr = StringIO.new
    begin
      out = provider.provide
      warning_output = $stderr.string
    ensure
      $stderr = old_stderr
    end

    assert_includes warning_output, "[WARNING] Aura-hint in long_hint.py was truncated because it exceeds the 1000 character limit"
    assert_includes out, "X" * 1000
    assert_includes out, "... [truncated: hint exceeds 1000 character limit]"
    refute_includes out, "X" * 1200

    # Now verify custom limit (e.g. 50 characters) via config.yml
    File.write(File.join(@project, "config", "config.yml"), <<~YAML)
      state_management:
        max_state_chars: 50000
      hints:
        max_hint_chars: 50
    YAML

    provider2 = Aura::Context::EnvironmentProvider.new(@project)

    old_stderr = $stderr
    $stderr = StringIO.new
    begin
      out2 = provider2.provide
      warning_output2 = $stderr.string
    ensure
      $stderr = old_stderr
    end

    assert_includes warning_output2, "[WARNING] Aura-hint in long_hint.py was truncated because it exceeds the 50 character limit"
    assert_includes out2, "X" * 50
    assert_includes out2, "... [truncated: hint exceeds 50 character limit]"
    refute_includes out2, "X" * 100
  end

  def test_active_variables_truncation
    db = DummyContextDb.new
    # Add a huge user-defined variable (>10000 chars)
    db.variables = { "huge_var" => "Y" * 15000, "small_var" => "short" }

    out = Aura::Context.assemble(@project, db)

    assert_includes out, "huge_var"
    assert_includes out, "Y" * 10000
    assert_includes out, "... [truncated]"
    refute_includes out, "Y" * 15000
    assert_includes out, "small_var: short"
  end
end
