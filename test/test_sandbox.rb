require "minitest/autorun"
require "aura/kernel/execution_engine"
require "json"
require "fileutils"

class TestSandbox < Minitest::Test
  def setup
    @project_path = File.expand_path("test_sandbox_project")
    FileUtils.mkdir_p(File.join(@project_path, "config"))
    FileUtils.mkdir_p(File.join(@project_path, "bin"))
    FileUtils.mkdir_p(File.join(@project_path, "tools", "hello"))
    
    # Create a dummy config
    File.write(File.join(@project_path, ".aura", "config", "config.yml"), <<~YAML)
      security:
        sandbox:
          enabled: true
          provider: "local"
    YAML
    
    # Create a dummy local wrapper that just echoes something
    File.write(File.join(@project_path, "bin", "sandbox-wrapper"), <<~SH)
      #!/bin/bash
      echo "===SANDBOXED==="
      exec "$@"
    SH
    FileUtils.chmod(0755, File.join(@project_path, "bin", "sandbox-wrapper"))

    # Create a simple Python tool
    File.write(File.join(@project_path, "tools", "hello", "logic.py"), <<~PY)
      import sys, json
      print(json.dumps({"status": "ok", "message": "hello from tool"}))
    PY
    File.write(File.join(@project_path, "tools", "hello", "manifest.json"), <<~JSON)
      {
        "name": "hello",
        "description": "test tool",
        "runtime": "python3",
        "entry": "logic.py"
      }
    JSON
  end

  def teardown
    FileUtils.rm_rf(@project_path)
  end

  def test_local_sandbox_execution
    engine = Aura::Kernel::ExecutionEngine.new(@project_path)
    res = engine.execute("hello", {})
    
    assert res.is_a?(Hash)
    content = res[:output] || res["output"] || ""
    assert content.include?("===SANDBOXED===")
  end
end
