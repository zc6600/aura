require "minitest/autorun"
require "stringio"
require "fileutils"

class TestKernelOnceHuman < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_kernel_once_human")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_kernel_once_human")
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_once_human_output_sections
    require "aura/cli/commands/kernel_command"
    payload = { tool: "read_file", args: { file_path: ".aura/config/config.yml", context_permissions: ["."] }, summary: "读取配置" }.to_json
    out = StringIO.new
    begin
      $stdout = out
      Aura::Commands::KernelCommand.start(["once", @app, "-H", "-n", "3", "-c", payload])
    ensure
      $stdout = STDOUT
    end
    s = out.string
    assert_includes s, "== Context Preview =="
    assert_includes s, "== Call =="
    assert_includes s, "Tool: read_file"
    assert_includes s, "Summary: 读取配置"
    assert_includes s, "== Result =="
  end
end
