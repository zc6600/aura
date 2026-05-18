require "minitest/autorun"
require "fileutils"

class TestLlmConfigPlannerGeneric < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_llm_generic")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_llm_generic")
    cfg = File.join(@app, "config", "config.yml")
    s = File.read(cfg)
    s = s.gsub('provider: "local"', 'provider: "acme_vendor"')
    s = s.gsub('model: "gpt-4o"', 'model: "acme/model-x"')
    s = s.gsub('max_state_chars: 4000', 'max_state_chars: 100000')
    File.write(cfg, s)
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_planner_runs_with_any_provider_in_config
    require "aura/kernel"
    runner = Aura::Kernel::Runner.new(@app)
    plan = runner.plan("仅输出JSON工具调用：读取config/config.yml（read_file）。")
    assert_equal "tool_call", plan[:type]
    assert_equal "read_file", plan[:tool]
    assert_equal "config/config.yml", plan[:args]["file_path"]
  end
end

