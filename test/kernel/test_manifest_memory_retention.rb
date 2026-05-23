require "minitest/autorun"
require "fileutils"
require "json"
require "aura"
require "aura/kernel/registry"
require "aura/memory"

class TestManifestMemoryRetention < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_manifest_memory")
    FileUtils.rm_rf(@app)
    FileUtils.mkdir_p(@app)
    
    # Create minimal config
    config_dir = File.join(@app, "config")
    FileUtils.mkdir_p(config_dir)
    File.write(File.join(config_dir, "config.yml"), <<~YAML)
      state_management:
        max_state_chars: 100000
        recent_events_n: 20
        summarization:
          enabled: true
          max_chars: 500
        retention:
          execution: { max_steps: 10, summarize: true }
    YAML
    
    # Create tool directory
    @tools_dir = File.join(@app, "tools")
    FileUtils.mkdir_p(@tools_dir)
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  # Test 1: Read memory config from manifest
  def test_read_memory_config_from_manifest
    tool_dir = File.join(@tools_dir, "bash_command")
    FileUtils.mkdir_p(tool_dir)
    
    manifest = {
      "name" => "bash_command",
      "description" => "Run shell commands",
      "memory" => {
        "retention" => "ephemeral",
        "summarize" => true,
        "max_steps" => 5
      }
    }
    File.write(File.join(tool_dir, "manifest.json"), JSON.pretty_generate(manifest))
    File.write(File.join(tool_dir, "logic.py"), "print('ok')")
    
    registry = Aura::Kernel::ToolRegistry.new(@app)
    registry.scan!
    
    tool_data = registry.find("bash_command")
    refute_nil tool_data
    
    memory_config = tool_data[:manifest]["memory"]
    refute_nil memory_config
    assert_equal "ephemeral", memory_config["retention"]
    assert_equal true, memory_config["summarize"]
    assert_equal 5, memory_config["max_steps"]
  end

  # Test 2: Policy reads manifest retention policy
  def test_metabolizer_reads_manifest_retention
    tool_dir = File.join(@tools_dir, "bash_command")
    FileUtils.mkdir_p(tool_dir)
    
    manifest = {
      "name" => "bash_command",
      "memory" => {
        "retention" => "ephemeral",
        "summarize" => true,
        "max_steps" => 3
      }
    }
    File.write(File.join(tool_dir, "manifest.json"), JSON.pretty_generate(manifest))
    File.write(File.join(tool_dir, "logic.py"), "print('ok')")
    
    registry = Aura::Kernel::ToolRegistry.new(@app)
    registry.scan!
    
    policy = Aura::Memory::Policy.new(registry: registry)
    policy_data = policy.send(:get_manifest_retention, "bash_command")
    refute_nil policy_data
    assert_equal 3, policy_data[:max_steps]
    assert_equal true, policy_data[:summarize]
    assert_equal "ephemeral", policy_data[:retention]
  end

  # Test 3: Manifest policy overrides global config
  def test_manifest_policy_overrides_global_config
    tool_dir = File.join(@tools_dir, "custom_tool")
    FileUtils.mkdir_p(tool_dir)
    
    manifest = {
      "name" => "custom_tool",
      "memory" => {
        "retention" => "permanent",
        "summarize" => false
      }
    }
    File.write(File.join(tool_dir, "manifest.json"), JSON.pretty_generate(manifest))
    File.write(File.join(tool_dir, "logic.py"), "print('ok')")
    
    registry = Aura::Kernel::ToolRegistry.new(@app)
    registry.scan!
    
    policy = Aura::Memory::Policy.new(registry: registry)
    policy_data = policy.send(:get_retention_policy, "execution", "custom_tool")
    assert_equal false, policy_data[:summarize]
    assert_equal 50, policy_data[:max_steps]
  end

  # Test 4: Fallback to global config when manifest has no memory
  def test_fallback_to_global_config
    tool_dir = File.join(@tools_dir, "simple_tool")
    FileUtils.mkdir_p(tool_dir)
    
    manifest = {
      "name" => "simple_tool",
      "description" => "No memory config"
    }
    File.write(File.join(tool_dir, "manifest.json"), JSON.pretty_generate(manifest))
    File.write(File.join(tool_dir, "logic.py"), "print('ok')")
    
    registry = Aura::Kernel::ToolRegistry.new(@app)
    registry.scan!
    
    config_path = File.join(@app, "config", "config.yml")
    require "yaml"
    cfg = YAML.load_file(config_path) || {}
    policy = Aura::Memory::Policy.new(
      registry: registry,
      retention: cfg.dig("state_management", "retention")
    )
    
    policy_data = policy.send(:get_retention_policy, "execution", "simple_tool")
    refute_nil policy_data
  end

  # Test 5: Fallback to defaults when no config at all
  def test_fallback_to_defaults
    registry = Aura::Kernel::ToolRegistry.new(@app)
    policy = Aura::Memory::Policy.new(registry: registry)
    
    policy_data = policy.send(:get_retention_policy, "unknown_phase", "nonexistent_tool")
    assert_equal 50, policy_data[:max_steps]
    assert_equal false, policy_data[:summarize]
  end

  # Test 6: Apply retention policy with manifest config
  def test_apply_retention_policy_with_manifest
    tool_dir = File.join(@tools_dir, "temp_tool")
    FileUtils.mkdir_p(tool_dir)
    
    manifest = {
      "name" => "temp_tool",
      "memory" => {
        "retention" => "ephemeral",
        "summarize" => true,
        "max_steps" => 2
      }
    }
    File.write(File.join(tool_dir, "manifest.json"), JSON.pretty_generate(manifest))
    File.write(File.join(tool_dir, "logic.py"), "print('ok')")
    
    registry = Aura::Kernel::ToolRegistry.new(@app)
    registry.scan!
    
    policy = Aura::Memory::Policy.new(registry: registry)
    
    events = [
      { "id" => 1, "phase" => "execution", "tool" => "temp_tool", "timestamp" => 1000 },
      { "id" => 2, "phase" => "execution", "tool" => "temp_tool", "timestamp" => 2000 },
      { "id" => 3, "phase" => "plan", "tool" => nil, "timestamp" => 3000 }
    ]
    
    result = policy.apply(events)
    
    temp_tool_events = result[:to_summarize].select { |e| e["tool"] == "temp_tool" }
    assert_equal 2, temp_tool_events.size
    
    plan_events = result[:to_delete].select { |e| e["phase"] == "plan" }
    assert_equal 1, plan_events.size
  end

  # Test 7: Permanent retention from manifest
  def test_permanent_retention_from_manifest
    tool_dir = File.join(@tools_dir, "milestone_tool")
    FileUtils.mkdir_p(tool_dir)
    
    manifest = {
      "name" => "milestone_tool",
      "memory" => {
        "retention" => "permanent",
        "summarize" => false,
        "permanent" => true
      }
    }
    File.write(File.join(tool_dir, "manifest.json"), JSON.pretty_generate(manifest))
    File.write(File.join(tool_dir, "logic.py"), "print('ok')")
    
    registry = Aura::Kernel::ToolRegistry.new(@app)
    registry.scan!
    
    policy = Aura::Memory::Policy.new(registry: registry)
    
    events = [
      { "id" => 1, "phase" => "execution", "tool" => "milestone_tool", "timestamp" => 1000 },
      { "id" => 2, "phase" => "execution", "tool" => "other_tool", "timestamp" => 2000 }
    ]
    
    result = policy.apply(events)
    
    kept_events = result[:to_keep]
    assert_equal 1, kept_events.size
    assert_equal "milestone_tool", kept_events[0]["tool"]
    
    deleted_events = result[:to_delete]
    assert_equal 1, deleted_events.size
    assert_equal "other_tool", deleted_events[0]["tool"]
  end

  # Test 8: Multiple tools with different retention tiers
  def test_multiple_tools_different_tiers
    eph_dir = File.join(@tools_dir, "ephemeral_tool")
    FileUtils.mkdir_p(eph_dir)
    File.write(File.join(eph_dir, "manifest.json"), JSON.pretty_generate({
      "name" => "ephemeral_tool",
      "memory" => { "retention" => "ephemeral", "summarize" => true, "max_steps" => 3 }
    }))
    File.write(File.join(eph_dir, "logic.py"), "print('ok')")
    
    work_dir = File.join(@tools_dir, "working_tool")
    FileUtils.mkdir_p(work_dir)
    File.write(File.join(work_dir, "manifest.json"), JSON.pretty_generate({
      "name" => "working_tool",
      "memory" => { "retention" => "working", "summarize" => false, "max_steps" => 50 }
    }))
    File.write(File.join(work_dir, "logic.py"), "print('ok')")
    
    perm_dir = File.join(@tools_dir, "permanent_tool")
    FileUtils.mkdir_p(perm_dir)
    File.write(File.join(perm_dir, "manifest.json"), JSON.pretty_generate({
      "name" => "permanent_tool",
      "memory" => { "retention" => "permanent", "summarize" => false, "permanent" => true }
    }))
    File.write(File.join(perm_dir, "logic.py"), "print('ok')")
    
    registry = Aura::Kernel::ToolRegistry.new(@app)
    registry.scan!
    
    policy = Aura::Memory::Policy.new(registry: registry)
    
    events = [
      { "id" => 1, "phase" => "execution", "tool" => "ephemeral_tool", "timestamp" => 1000 },
      { "id" => 2, "phase" => "execution", "tool" => "working_tool", "timestamp" => 2000 },
      { "id" => 3, "phase" => "execution", "tool" => "permanent_tool", "timestamp" => 3000 }
    ]
    
    result = policy.apply(events)
    
    assert_equal 1, result[:to_summarize].size
    assert_equal "ephemeral_tool", result[:to_summarize][0]["tool"]
    
    working_deleted = result[:to_delete].select { |e| e["tool"] == "working_tool" }
    assert_equal 1, working_deleted.size
    
    assert_equal 1, result[:to_keep].size
    assert_equal "permanent_tool", result[:to_keep][0]["tool"]
  end

  # Test 9: Manifest without memory field uses defaults
  def test_manifest_without_memory_field
    tool_dir = File.join(@tools_dir, "no_memory_tool")
    FileUtils.mkdir_p(tool_dir)
    
    manifest = {
      "name" => "no_memory_tool",
      "description" => "No memory configuration"
    }
    File.write(File.join(tool_dir, "manifest.json"), JSON.pretty_generate(manifest))
    File.write(File.join(tool_dir, "logic.py"), "print('ok')")
    
    registry = Aura::Kernel::ToolRegistry.new(@app)
    registry.scan!
    
    policy = Aura::Memory::Policy.new(registry: registry)
    
    policy_data = policy.send(:get_manifest_retention, "no_memory_tool")
    assert_nil policy_data
    
    fallback_policy = policy.send(:get_retention_policy, "execution", "no_memory_tool")
    refute_nil fallback_policy
  end

  # Test 10: Incomplete memory config uses sensible defaults
  def test_incomplete_memory_config
    tool_dir = File.join(@tools_dir, "partial_tool")
    FileUtils.mkdir_p(tool_dir)
    
    manifest = {
      "name" => "partial_tool",
      "memory" => {
        "retention" => "working"
      }
    }
    File.write(File.join(tool_dir, "manifest.json"), JSON.pretty_generate(manifest))
    File.write(File.join(tool_dir, "logic.py"), "print('ok')")
    
    registry = Aura::Kernel::ToolRegistry.new(@app)
    registry.scan!
    
    policy = Aura::Memory::Policy.new(registry: registry)
    
    policy_data = policy.send(:get_manifest_retention, "partial_tool")
    refute_nil policy_data
    assert_equal "working", policy_data[:retention]
    assert_equal false, policy_data[:summarize]
    assert_equal 50, policy_data[:max_steps]
  end
end
