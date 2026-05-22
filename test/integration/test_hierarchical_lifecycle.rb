require "minitest/autorun"
require "fileutils"
require "aura/kernel"
require "aura/context"

class TestHierarchicalLifecycle < Minitest::Test
  def setup
    @project = File.join(Dir.pwd, "tmp_integration_project")
    FileUtils.rm_rf(@project)
    FileUtils.mkdir_p(@project)
    
    # 1. Create a tool group using CLI/Generator simulation
    require "aura/generators/tool_group_generator"
    gen = Aura::Generators::ToolGroupGenerator.new(["browser", ["click"]], {}, { destination_root: File.join(@project, ".aura") })
    gen.invoke_all
    
    # 2. Modify browser/open/logic.py to return a context_id
    open_logic = File.join(@project, ".aura", "tools/browser/open/logic.py")
    File.write(open_logic, <<~PYTHON)
      import sys, json
      print(json.dumps({"success": True, "context_id": "session_123", "data": {"url": "http://example.com"}}))
    PYTHON
    
    # 3. Modify browser/click/logic.py to confirm it received context_id
    click_logic = File.join(@project, ".aura", "tools/browser/click/logic.py")
    File.write(click_logic, <<~PYTHON)
      import sys, json
      args = json.loads(sys.stdin.read())
      if args.get("context_id") == "session_123":
        print(json.dumps({"success": True, "message": "Clicked with session_123"}))
      else:
        print(json.dumps({"success": False, "error": "Wrong context_id"}))
    PYTHON

    # 4. Modify browser/close/logic.py to signal destruction
    close_logic = File.join(@project, ".aura", "tools/browser/close/logic.py")
    File.write(close_logic, <<~PYTHON)
      import sys, json
      args = json.loads(sys.stdin.read())
      print(json.dumps({"success": True, "context_destroyed": args.get("context_id")}))
    PYTHON

    FileUtils.mkdir_p(File.join(@project, ".aura", "config"))
    File.write(File.join(@project, ".aura", "config", "config.yml"), "tool_protocol: { core_tools: [] }")
  end

  def teardown
    FileUtils.rm_rf(@project)
  end

  def test_lifecycle_flow
    runner = Aura::Kernel::Runner.new(@project)
    
    # Step A: Initially, browser_click should NOT be in context (active tools)
    ctx = runner.observe
    refute_includes ctx, "## browser_click"
    
    # Step B: Open browser
    res = runner.run_call({ "tool" => "browser_open", "args" => {}, "summary" => "Open browser" })
    assert res["success"]
    assert_equal "session_123", res["context_id"]
    
    # Step C: After opening, browser_click SHOULD be in context
    ctx = runner.observe
    assert_includes ctx, "## browser_click"
    assert_includes ctx, "Active instances: session_123"
    
    # Step D: Use click
    res = runner.run_call({ "tool" => "browser_click", "args" => { "context_id" => "session_123" }, "summary" => "Click" })
    assert res["success"]
    assert_equal "Clicked with session_123", res["message"]
    
    # Step E: Close browser
    res = runner.run_call({ "tool" => "browser_close", "args" => { "context_id" => "session_123" }, "summary" => "Close browser" })
    assert res["success"]
    assert_equal "session_123", res["context_destroyed"]
    
    # Step F: After closing, browser_click SHOULD BE GONE
    ctx = runner.observe
    refute_includes ctx, "## browser_click"
  end
end
