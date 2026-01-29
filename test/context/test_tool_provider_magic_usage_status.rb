require "minitest/autorun"
require "fileutils"
require "aura/context"

class TestToolProviderEnhancements < Minitest::Test
  def setup
    @project = File.join(Dir.pwd, "tmp_tool_project")
    FileUtils.rm_rf(@project)
    FileUtils.mkdir_p(@project)
    FileUtils.mkdir_p(File.join(@project, "tools", "t1"))
    File.write(File.join(@project, "tools", "t1", "manifest.json"), {
      name: "t1",
      description: "demo",
      permissions: { fs: "ro" },
      auto_load: true,
      input_schema: {
        type: "object",
        properties: { file_path: { type: "string" } },
        required: ["file_path"]
      }
    }.to_json)
    File.write(File.join(@project, "tools", "t1", "logic.py"), "# @aura-hint: keep simple\nprint('x')")
    # Missing test.py to trigger [DISABLED]
    FileUtils.mkdir_p(File.join(@project, "config"))
    File.write(File.join(@project, "config", "config.yml"), <<~YAML)
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

  def test_usage_magic_comments_and_status
    out = Aura::Context.assemble(@project, nil)
    assert_includes out, "Usage:"
    assert_includes out, "\"file_path\":\"string\""
    assert_includes out, "Status: [DISABLED]"
  end
end
