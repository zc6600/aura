require "minitest/autorun"
require "fileutils"
require "json"

class TestExecutionEngineParsing < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_exec_engine")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_exec_engine")
    @tools = File.join(@app, ".aura", "tools")
    FileUtils.mkdir_p(@tools)
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def write_tool(dir, logic_body, manifest = { "runtime" => "python", "entry" => "logic.py" })
    FileUtils.mkdir_p(dir)
    File.write(File.join(dir, "manifest.json"), manifest.to_json)
    File.write(File.join(dir, "logic.py"), logic_body)
  end

  def test_success_plain_text_output
    dir = File.join(@tools, "plain_output")
    py = <<~PY
      import sys
      print("hello")
    PY
    write_tool(dir, py)
    require "aura/kernel/execution_engine"
    eng = Aura::Kernel::ExecutionEngine.new(@app)
    res = eng.execute("plain_output", {})
    assert_equal "ok", res["status"]
    assert_equal "hello\n", res[:output]
  end

  def test_success_json_output
    dir = File.join(@tools, "json_output")
    py = <<~PY
      import sys, json
      print(json.dumps({"status":"ok","content":"world"}))
    PY
    write_tool(dir, py)
    require "aura/kernel/execution_engine"
    eng = Aura::Kernel::ExecutionEngine.new(@app)
    res = eng.execute("json_output", {})
    assert_equal "ok", res["status"]
    assert_equal "world", res["content"]
  end

  def test_failure_nonzero_exit
    dir = File.join(@tools, "bad_output")
    py = <<~PY
      import sys
      sys.stderr.write("boom")
      sys.exit(1)
    PY
    write_tool(dir, py)
    require "aura/kernel/execution_engine"
    eng = Aura::Kernel::ExecutionEngine.new(@app)
    res = eng.execute("bad_output", {})
    assert_equal "failed", res[:status]
    assert_includes res[:error], "boom"
  end
end
