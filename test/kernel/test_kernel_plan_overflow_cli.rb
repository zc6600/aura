require "minitest/autorun"
require "stringio"
require "fileutils"
require "yaml"

class TestKernelPlanOverflowCli < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_kernel_plan_overflow")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_kernel_plan_overflow")
    cfg = File.join(@app, ".aura", "config", "config.yml")
    data = YAML.load_file(cfg) || {}
    data["state_management"] ||= {}
    data["state_management"]["max_state_chars"] = 100
    File.write(cfg, data.to_yaml)
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_plan_human_overflow_preview
    require "aura/cli/commands/kernel_command"
    out = StringIO.new
    begin
      $stdout = out
      Aura::Commands::KernelCommand.start(["plan", @app, "-H", "-n", "5"]) 
    ensure
      $stdout = STDOUT
    end
    s = out.string
    assert_includes s, "== Context Preview =="
    assert_includes s, "[Context overflow]"
    assert_includes s, "== Plan =="
  end
end
