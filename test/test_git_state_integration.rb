require "minitest/autorun"
require "aura/kernel/execution_engine"
require "fileutils"
require "json"
require "yaml"
require "open3"

class TestGitStateIntegration < Minitest::Test
  def setup
    @project_path = File.expand_path("tmp_git_test")
    FileUtils.rm_rf(@project_path)
    FileUtils.mkdir_p(@project_path)
    
    # Init git repo
    Open3.capture3("git init", chdir: @project_path)
    Open3.capture3("git config user.email 'test@example.com'", chdir: @project_path)
    Open3.capture3("git config user.name 'Test User'", chdir: @project_path)
    
    # Create config with snapshots enabled
    FileUtils.mkdir_p(File.join(@project_path, "config"))
    File.write(File.join(@project_path, "config", "config.yml"), {
      "security" => {
        "git_snapshots" => true
      }
    }.to_yaml)
    
    # Create a dummy tool for the engine to find
    FileUtils.mkdir_p(File.join(@project_path, "tools", "dummy"))
    File.write(File.join(@project_path, "tools", "dummy", "manifest.json"), {
      name: "dummy",
      runtime: "python3",
      entry: "logic.py"
    }.to_json)
    File.write(File.join(@project_path, "tools", "dummy", "logic.py"), "import json; print(json.dumps({'output': 'hello'}))")
    
    # Initial commit to have a base
    File.write(File.join(@project_path, "initial.txt"), "hello")
    Open3.capture3("git add .", chdir: @project_path)
    Open3.capture3("git commit -m 'Initial commit'", chdir: @project_path)
  end

  def teardown
    FileUtils.rm_rf(@project_path)
  end

  def test_git_snapshot_after_tool_call
    engine = Aura::Kernel::ExecutionEngine.new(@project_path)
    
    # Create a change manually that the tool will "fix" or just tool execution in general
    # Actually our dummy tool doesn't change files, so we modify logic.py to simulate a change
    File.write(File.join(@project_path, "change.txt"), "modified")
    
    # Execute tool
    res = engine.execute("dummy", {})
    assert_equal "ok", res["status"]
    
    # Verify commit was made
    out, _err, _status = Open3.capture3("git log -n 1 --pretty=format:%s", chdir: @project_path)
    assert_includes out, "[Aura] Tool execution: dummy"
  end
end
