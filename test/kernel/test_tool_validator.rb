# frozen_string_literal: true

require "test_helper"
require "aura/kernel/tool_validator"
require "aura/kernel/registry"
require "tmpdir"
require "fileutils"
require "json"
require "yaml"

# Mock State for testing
class MockState
  attr_reader :variables

  def initialize
    @variables = {}
  end

  def get_active_variables
    @variables.dup
  end

  def set_variable(key, value)
    @variables[key] = value
  end
end

# Mock Registry for testing
class MockRegistry
  def initialize
    @tools = {}
  end

  def add_tool(name, path, manifest)
    @tools[name] = { path: path, manifest: manifest }
  end

  def find(name)
    @tools[name]
  end

  def all_tools
    @tools.keys
  end
end

class TestToolValidator < Minitest::Test
  def setup
    @tmpdir = Dir.mktmpdir("aura-validator-test")
    @tools_path = File.join(@tmpdir, "tools")
    Dir.mkdir(@tools_path)
    @config_path = File.join(@tmpdir, "config")
    Dir.mkdir(@config_path)
    @mock_state = MockState.new
    @mock_registry = MockRegistry.new
  end

  def create_validator(registry: nil, state: nil)
    reg = registry || @mock_registry
    st = state || @mock_state
    Aura::Kernel::ToolValidator.new(@tmpdir, reg, st)
  end

  # Test 1: Nil tool name returns draft
  def test_nil_tool_name_returns_draft
    validator = create_validator
    result = validator.status_for(nil)

    assert_equal "draft", result[:state]
    assert_match /nil/, result[:reason]
  end

  # Test 2: Empty tool name returns draft
  def test_empty_tool_name_returns_draft
    validator = create_validator
    result = validator.status_for("")

    assert_equal "draft", result[:state]
  end

  # Test 3: MCP tools always ready
  def test_mcp_tools_always_ready
    validator = create_validator
    result = validator.status_for("mcp.some_tool")

    assert_equal "ready", result[:state]
    assert result[:verified]
  end

  # Test 4: Tool not in registry returns draft
  def test_tool_not_in_registry_returns_draft
    validator = create_validator(registry: @mock_registry)
    result = validator.status_for("nonexistent")

    assert_equal "draft", result[:state]
    assert_match /not found/, result[:reason]
  end

  # Test 5: Missing manifest.json returns draft
  def test_missing_manifest_returns_draft
    tool_dir = File.join(@tools_path, "incomplete_tool")
    Dir.mkdir(tool_dir)

    validator = create_validator(registry: @mock_registry)
    result = validator.status_for("incomplete_tool")

    assert_equal "draft", result[:state]
    assert_match /manifest/, result[:reason]
  end

  # Test 6: Tool with all required files is ready
  def test_tool_with_all_files_is_ready
    tool_dir = File.join(@tools_path, "valid_tool")
    Dir.mkdir(tool_dir)
    File.write(File.join(tool_dir, "manifest.json"), JSON.generate({
      "name" => "valid_tool",
      "test" => "test.py"
    }))
    File.write(File.join(tool_dir, "logic.py"), "# logic")
    File.write(File.join(tool_dir, "test.py"), "# test")

    registry = MockRegistry.new
    registry.add_tool("valid_tool", tool_dir, { "name" => "valid_tool", "test" => "test.py" })

    validator = create_validator(registry: registry)
    result = validator.status_for("valid_tool")

    assert_equal "ready", result[:state]
  end

  # Test 7: Missing required files returns draft
  def test_missing_required_files_returns_draft
    # Create config that requires logic.py
    File.write(File.join(@config_path, "config.yml"), YAML.dump({
      "tool_protocol" => {
        "required_files" => ["manifest.json", "logic.py", "test.py"]
      }
    }))

    tool_dir = File.join(@tools_path, "partial_tool")
    Dir.mkdir(tool_dir)
    File.write(File.join(tool_dir, "manifest.json"), JSON.generate({
      "name" => "partial_tool"
    }))
    # Missing logic.py and test.py

    registry = MockRegistry.new
    registry.add_tool("partial_tool", tool_dir, { "name" => "partial_tool", "test" => "test.py" })

    validator = create_validator(registry: registry)
    result = validator.status_for("partial_tool")

    assert_equal "draft", result[:state]
    assert_match /missing/, result[:reason]
  end

  # Test 8: Skip test bypasses test file requirement
  def test_skip_test_bypasses_requirement
    tool_dir = File.join(@tools_path, "skip_test_tool")
    Dir.mkdir(tool_dir)
    File.write(File.join(tool_dir, "manifest.json"), JSON.generate({
      "name" => "skip_test_tool",
      "skip_test" => true
    }))
    # No test.py

    registry = MockRegistry.new
    registry.add_tool("skip_test_tool", tool_dir, { "name" => "skip_test_tool", "skip_test" => true })

    validator = create_validator(registry: registry)
    result = validator.status_for("skip_test_tool")

    assert_equal "ready", result[:state]
    refute result[:verified]  # Not verified because test skipped
  end

  # Test 9: State cache returns verified
  def test_state_cache_returns_verified
    @mock_state.set_variable("tool_status:cached_tool", "ready")

    tool_dir = File.join(@tools_path, "cached_tool")
    Dir.mkdir(tool_dir)
    File.write(File.join(tool_dir, "manifest.json"), JSON.generate({
      "name" => "cached_tool"
    }))
    File.write(File.join(tool_dir, "test.py"), "# test")

    registry = MockRegistry.new
    registry.add_tool("cached_tool", tool_dir, { "name" => "cached_tool" })

    validator = create_validator(registry: registry, state: @mock_state)
    result = validator.status_for("cached_tool")

    assert_equal "ready", result[:state]
    assert result[:verified]
  end

  # Test 10: ensure_active returns ok for MCP tools
  def test_ensure_active_ok_for_mcp
    validator = create_validator
    result = validator.ensure_active("mcp.tool")

    assert result[:ok]
  end

  # Test 11: ensure_active fails for nonexistent tool
  def test_ensure_active_fails_for_nonexistent
    validator = create_validator(registry: @mock_registry)
    result = validator.ensure_active("missing")

    refute result[:ok]
    assert_match /not found/, result[:advice]
  end

  # Test 12: ensure_active checks requires_context
  def test_ensure_active_checks_requires_context
    tool_dir = File.join(@tools_path, "context_tool")
    Dir.mkdir(tool_dir)
    File.write(File.join(tool_dir, "manifest.json"), JSON.generate({
      "name" => "context_tool",
      "requires_context" => "browser",
      "skip_test" => true
    }))

    registry = MockRegistry.new
    registry.add_tool("context_tool", tool_dir, {
      "name" => "context_tool",
      "requires_context" => "browser",
      "skip_test" => true
    })

    validator = create_validator(registry: registry)
    result = validator.ensure_active("context_tool")

    refute result[:ok]
    assert_match /requires.*browser/, result[:advice]
  end

  # Test 13: ensure_active with skip_test returns ok
  def test_ensure_active_skip_test_returns_ok
    tool_dir = File.join(@tools_path, "simple_tool")
    Dir.mkdir(tool_dir)
    File.write(File.join(tool_dir, "manifest.json"), JSON.generate({
      "name" => "simple_tool",
      "skip_test" => true
    }))

    registry = MockRegistry.new
    registry.add_tool("simple_tool", tool_dir, { "name" => "simple_tool", "skip_test" => true })

    validator = create_validator(registry: registry, state: @mock_state)
    result = validator.ensure_active("simple_tool")

    assert result[:ok]
  end

  # Test 14: ensure_active caches verification in state
  def test_ensure_active_caches_in_state
    tool_dir = File.join(@tools_path, "cacheable_tool")
    Dir.mkdir(tool_dir)
    File.write(File.join(tool_dir, "manifest.json"), JSON.generate({
      "name" => "cacheable_tool",
      "skip_test" => true
    }))

    registry = MockRegistry.new
    registry.add_tool("cacheable_tool", tool_dir, { "name" => "cacheable_tool", "skip_test" => true })

    state = MockState.new
    validator = create_validator(registry: registry, state: state)
    validator.ensure_active("cacheable_tool")

    assert_equal "ready", state.variables["tool_status:cacheable_tool"]
    assert state.variables.key?("tool_mtime:cacheable_tool")
  end

  # Test 15: ensure_active skips test if cache valid
  def test_ensure_active_skips_test_if_cache_valid
    tool_dir = File.join(@tools_path, "cached_tool2")
    Dir.mkdir(tool_dir)
    File.write(File.join(tool_dir, "manifest.json"), JSON.generate({
      "name" => "cached_tool2"
    }))
    File.write(File.join(tool_dir, "test.py"), "# test")

    # Set up cache with current mtime
    current_mtime = File.mtime(tool_dir).to_i
    state = MockState.new
    state.set_variable("tool_status:cached_tool2", "ready")
    state.set_variable("tool_mtime:cached_tool2", current_mtime)

    registry = MockRegistry.new
    registry.add_tool("cached_tool2", tool_dir, { "name" => "cached_tool2", "test" => "test.py" })

    validator = create_validator(registry: registry, state: state)
    result = validator.ensure_active("cached_tool2")

    assert result[:ok]
    assert result[:cached]
  end

  # Test 16: build_advice formats error message
  def test_build_advice_formats_error
    validator = create_validator
    trace = "Traceback (most recent call last):\n  File \"test.py\", line 1\n    raise Exception(\"boom\")\nException: boom"

    advice = validator.build_advice("test_tool", trace)

    assert_match /test_tool/, advice
    assert_match /boom/, advice
  end

  # Test 17: Config required_files respected
  def test_config_required_files_respected
    # Create config with custom required files
    File.write(File.join(@config_path, "config.yml"), YAML.dump({
      "tool_protocol" => {
        "required_files" => ["manifest.json", "logic.py"]
      }
    }))

    tool_dir = File.join(@tools_path, "config_tool")
    Dir.mkdir(tool_dir)
    File.write(File.join(tool_dir, "manifest.json"), JSON.generate({
      "name" => "config_tool"
    }))
    File.write(File.join(tool_dir, "logic.py"), "# logic")
    # Missing test.py (not in config)

    registry = MockRegistry.new
    registry.add_tool("config_tool", tool_dir, { "name" => "config_tool", "test" => "test.py" })

    validator = create_validator(registry: registry)
    result = validator.status_for("config_tool")

    # Should be ready because config doesn't require test.py
    assert_equal "ready", result[:state]
  end

  # Test 18: Manifest verification settings override config
  def test_manifest_verification_overrides_config
    File.write(File.join(@config_path, "config.yml"), YAML.dump({
      "tool_protocol" => {
        "required_files" => ["manifest.json", "test.py"]
      }
    }))

    tool_dir = File.join(@tools_path, "override_tool")
    Dir.mkdir(tool_dir)
    File.write(File.join(tool_dir, "manifest.json"), JSON.generate({
      "name" => "override_tool",
      "verification" => {
        "require_test" => false
      }
    }))
    File.write(File.join(tool_dir, "logic.py"), "# logic")
    # Missing test.py

    registry = MockRegistry.new
    registry.add_tool("override_tool", tool_dir, {
      "name" => "override_tool",
      "verification" => { "require_test" => false }
    })

    validator = create_validator(registry: registry)
    result = validator.status_for("override_tool")

    assert_equal "ready", result[:state]
  end
end
