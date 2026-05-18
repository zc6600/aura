require "minitest/autorun"
require "stringio"
require "fileutils"

class TestKernelPlanCli < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_kernel_plan")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_kernel_plan")
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_kernel_plan_returns_tool_call
    require "aura/cli/commands/kernel_command"
    out = StringIO.new
    begin
      $stdout = out
      Aura::Commands::KernelCommand.start(["plan", @app, "-H"]) 
    ensure
      $stdout = STDOUT
    end
    s = out.string
    assert_includes s, "== Plan =="
    assert_includes s, "\"tool\":\"read_file\""
  end
end

