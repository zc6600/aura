require "minitest/autorun"
require "fileutils"
require "aura/context"

class DummyDb
  def get_latest_summary
    "Summary text"
  end
  def get_active_variables
    { "goal" => "build" }
  end
  def get_recent_events
    "recent events"
  end
end

class TestContextBase < Minitest::Test
  def setup
    @project = File.join(Dir.pwd, "tmp_ctx_project")
    FileUtils.rm_rf(@project)
    FileUtils.mkdir_p(@project)
    FileUtils.mkdir_p(File.join(@project, "tools", "t1"))
    FileUtils.mkdir_p(File.join(@project, "knowledge"))
    File.write(File.join(@project, "tools", "t1", "manifest.json"), { name: "t1", description: "d", permissions: { fs: "ro" }, auto_load: true }.to_json)
    File.write(File.join(@project, "tools", "t1", "logic.py.hint"), "hint text")
    File.write(File.join(@project, "knowledge", "k.txt"), "k")
    # minimal config for required_files
    FileUtils.mkdir_p(File.join(@project, "config"))
    File.write(File.join(@project, ".aura", "config", "config.yml"), <<~YAML)
      tool_protocol:
        required_files:
          - logic.py
          - manifest.json
          - test.py
      state_management:
        max_state_chars: 10000
    YAML
  end

  def teardown
    FileUtils.rm_rf(@project)
  end

  def test_assemble_includes_sections
    db = DummyDb.new
    out = Aura::Context.assemble(@project, db)
    assert_includes out, "# ACTIVE TOOLS (Ready to use)"
    assert_includes out, "## t1"
    assert_includes out, "# AGENT STATE & MEMORY"
    assert_includes out, "History"
    assert_includes out, "Active Variables"
    assert_includes out, "# SYSTEM & ENVIRONMENT"
  end
end
