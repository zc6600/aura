require "minitest/autorun"
require "fileutils"
require "aura"

class TestToolValidator < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_tool_validator")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_tool_validator")
    # Ensure required files include manifest.json and test.py
    cfg = File.join(@app, ".aura", "config", "config.yml")
    content = File.read(cfg)
    unless content.include?("required_files:")
      File.open(cfg, "a") { |f| f.puts("tool_protocol:\n  required_files:\n    - logic.py\n    - manifest.json\n    - test.py\n") }
    end
    @tool_dir = File.join(@app, ".aura", "tools", "alpha")
    FileUtils.mkdir_p(@tool_dir)
    File.write(File.join(@tool_dir, "logic.py"), "print(1)")
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_status_transitions_to_ready
    require "aura/kernel/tool_validator"
    v = Aura::Kernel::ToolValidator.new(@app)
    st1 = v.status_for("alpha")
    assert_equal "draft", st1[:state]
    assert_includes st1[:reason], "manifest.json"
    File.write(File.join(@tool_dir, "manifest.json"), { name: "alpha" }.to_json)
    File.write(File.join(@tool_dir, "test.py"), "print('ok')")
    v.instance_variable_get(:@registry).scan!
    st2 = v.status_for("alpha")
    assert_equal "ready", st2[:state]
  end

  def test_caching_skips_test_execution
    require "aura/kernel/tool_validator"
    require "aura/kernel/state"
    
    state = Aura::Kernel::State.new(@app)
    v = Aura::Kernel::ToolValidator.new(@app, nil, state)
    
    # 1. Setup tool
    File.write(File.join(@tool_dir, "manifest.json"), { name: "alpha" }.to_json)
    File.write(File.join(@tool_dir, "test.py"), "print('ok')")
    v.instance_variable_get(:@registry).scan!
    
    # 2. First run: should execute test
    res1 = v.ensure_active("alpha")
    assert res1[:ok], "Should be ok: #{res1[:advice]}"
    refute res1[:cached]
    
    # 3. Second run: should be cached
    res2 = v.ensure_active("alpha")
    assert res2[:ok]
    assert res2[:cached]
    
    # 4. Modify tool: should execute test again
    sleep 1 # Ensure mtime changes
    File.write(File.join(@tool_dir, "logic.py"), "print(2)")
    res3 = v.ensure_active("alpha")
    assert res3[:ok]
    refute res3[:cached]
  end

  def test_requires_context_validation
    require "aura/kernel/tool_validator"
    require "aura/context/manager"
    
    # 1. Setup subtool that requires 'browser_session'
    sub_dir = File.join(@app, ".aura", "tools", "click")
    FileUtils.mkdir_p(sub_dir)
    File.write(File.join(sub_dir, "manifest.json"), { 
      name: "click", 
      requires_context: "browser_session",
      test: "test.py" 
    }.to_json)
    File.write(File.join(sub_dir, "test.py"), "print('ok')")
    
    v = Aura::Kernel::ToolValidator.new(@app)
    v.instance_variable_get(:@registry).scan!
    
    # 2. Should fail because context is not active
    res = v.ensure_active("click")
    refute res[:ok]
    assert_includes res[:advice], "requires active 'browser_session' context"
    
    # 3. Add context and try again
    manager = Aura::Context::Manager.new(@app)
    manager.add_context("browser_session", { url: "test" }, id: "test_ctx")
    
    res2 = v.ensure_active("click")
    assert res2[:ok]
  end
end

