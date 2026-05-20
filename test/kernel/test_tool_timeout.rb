require "minitest/autorun"
require "fileutils"
require "json"
require "yaml"

class TestToolTimeout < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_tool_timeout")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_tool_timeout")
    @tools = File.join(@app, ".aura", "tools")
    FileUtils.mkdir_p(@tools)
    @config_path = File.join(@app, ".aura", "config", "config.yml")
  end

  def teardown
    Dir.chdir(File.expand_path("../..", __dir__))
    FileUtils.rm_rf(@app)
  end

  def write_tool(dir, logic_body, manifest = { "runtime" => "python", "entry" => "logic.py" })
    FileUtils.mkdir_p(dir)
    File.write(File.join(dir, "manifest.json"), manifest.to_json)
    File.write(File.join(dir, "logic.py"), logic_body)
  end

  def write_config(hash)
    File.write(@config_path, YAML.dump(hash))
  end

  # Helper to mock capture3_with_timeout and return the resolved timeout value
  def get_resolved_timeout(tool_name, args, config_hash = nil, manifest_hash = nil)
    write_config(config_hash) if config_hash
    
    dir = File.join(@tools, tool_name)
    manifest = { "runtime" => "python", "entry" => "logic.py" }
    manifest.merge!(manifest_hash) if manifest_hash
    write_tool(dir, "print('ok')", manifest)

    require "aura/kernel/execution_engine"
    # Rescan registry to pick up the new tool
    eng = Aura::Kernel::ExecutionEngine.new(@app)
    eng.instance_variable_get(:@registry).scan!

    timeout_passed = nil
    eng.define_singleton_method(:capture3_with_timeout) do |cmd, stdin_data, chdir, timeout_val|
      timeout_passed = timeout_val
      ["{}", "", Struct.new(:success?).new(true)]
    end

    eng.execute(tool_name, args)
    timeout_passed
  end

  def test_default_timeout_from_config
    cfg = {
      "tool_protocol" => {
        "default_timeout_seconds" => 150,
        "max_timeout_seconds" => 600,
        "agent_can_modify_timeout" => true
      }
    }
    timeout = get_resolved_timeout("t1", {}, cfg, {})
    assert_equal 150.0, timeout
  end

  def test_manifest_timeout_override
    cfg = {
      "tool_protocol" => {
        "default_timeout_seconds" => 150,
        "max_timeout_seconds" => 600,
        "agent_can_modify_timeout" => true
      }
    }
    timeout = get_resolved_timeout("t2", {}, cfg, { "timeout" => 80 })
    assert_equal 80.0, timeout
  end

  def test_agent_override_allowed
    cfg = {
      "tool_protocol" => {
        "default_timeout_seconds" => 150,
        "max_timeout_seconds" => 600,
        "agent_can_modify_timeout" => true
      }
    }
    timeout = get_resolved_timeout("t3", { "timeout_seconds" => 45 }, cfg, {})
    assert_equal 45.0, timeout

    # test alternative arg key
    timeout_alt = get_resolved_timeout("t3_alt", { "timeout" => 55 }, cfg, {})
    assert_equal 55.0, timeout_alt
  end

  def test_agent_override_denied_by_config
    cfg = {
      "tool_protocol" => {
        "default_timeout_seconds" => 150,
        "max_timeout_seconds" => 600,
        "agent_can_modify_timeout" => false
      }
    }
    timeout = get_resolved_timeout("t4", { "timeout_seconds" => 45 }, cfg, {})
    assert_equal 150.0, timeout
  end

  def test_agent_override_denied_by_manifest_precedence
    cfg = {
      "tool_protocol" => {
        "default_timeout_seconds" => 150,
        "max_timeout_seconds" => 600,
        "agent_can_modify_timeout" => true
      }
    }
    # Manifest says false, overriding config's true
    timeout = get_resolved_timeout("t5", { "timeout_seconds" => 45 }, cfg, { "timeout" => 90, "agent_can_modify_timeout" => false })
    assert_equal 90.0, timeout
  end

  def test_max_timeout_clamping
    cfg = {
      "tool_protocol" => {
        "default_timeout_seconds" => 150,
        "max_timeout_seconds" => 200,
        "agent_can_modify_timeout" => true
      }
    }
    # Manifest asks for 300, clamped to 200
    timeout_manifest = get_resolved_timeout("t6", {}, cfg, { "timeout" => 300 })
    assert_equal 200.0, timeout_manifest

    # Agent asks for 400, clamped to 200
    timeout_agent = get_resolved_timeout("t7", { "timeout_seconds" => 400 }, cfg, {})
    assert_equal 200.0, timeout_agent
  end

  def test_real_subprocess_timeout
    cfg = {
      "tool_protocol" => {
        "default_timeout_seconds" => 5,
        "max_timeout_seconds" => 20,
        "agent_can_modify_timeout" => true
      }
    }
    write_config(cfg)

    dir = File.join(@tools, "hanging_tool")
    py = <<~PY
      import time
      time.sleep(10)
      print("finished")
    PY
    write_tool(dir, py, { "runtime" => "python", "entry" => "logic.py", "timeout" => 1 })

    require "aura/kernel/execution_engine"
    eng = Aura::Kernel::ExecutionEngine.new(@app)
    eng.instance_variable_get(:@registry).scan!

    start_time = Time.now
    res = eng.execute("hanging_tool", {})
    elapsed = Time.now - start_time

    assert elapsed < 5, "Process did not time out quickly enough, took #{elapsed}s"
    assert_equal "failed", res[:status]
    assert_includes res[:error], "timed out"
  end
end
