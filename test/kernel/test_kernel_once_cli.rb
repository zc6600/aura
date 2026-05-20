require "minitest/autorun"
require "stringio"
require "json"
require "fileutils"

class TestKernelOnceCli < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_kernel_once")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_kernel_once")
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_kernel_once_runs_tool
    require "aura/cli/commands/kernel_command"
    payload = { tool: "read_file", args: { file_path: ".aura/config/config.yml", context_permissions: ["."] } }.to_json
    out = StringIO.new
    begin
      $stdout = out
      Aura::Commands::KernelCommand.start(["once", @app, "-c", payload])
    ensure
      $stdout = STDOUT
    end
    s = out.string
    data = JSON.parse(s)
    assert data.key?("context_preview")
    assert data.key?("result")
    assert_includes data["result"].to_s, "workspace_root"
  end
end
