require "minitest/autorun"
require "fileutils"

class TestOpenRouterIntegration < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_openrouter_real")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_openrouter_real")
    # copy root .env into project (assumes OPENROUTER_API_KEY present)
    root_env = File.join(Dir.pwd, ".env")
    if File.exist?(root_env)
      FileUtils.cp(root_env, File.join(@app, ".env"))
    end
    # set provider/model and increase budgets
    cfg = File.join(@app, ".aura", "config", "config.yml")
    s = File.read(cfg)
    s = s.gsub('provider: "local"', 'provider: "openrouter"')
    s = s.gsub('model: "gpt-4o"', 'model: "upstage/solar-pro-3:free"')
    s = s.gsub('max_state_chars: 4000', 'max_state_chars: 100000')
    s = s.gsub('max_tokens: 512', 'max_tokens: 2048')
    File.write(cfg, s)
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_planner_with_real_llm_returns_useful_plan
    skip "set RUN_REAL_LLM_TESTS=1 to run" unless ENV["RUN_REAL_LLM_TESTS"] == "1"
    skip "missing OPENROUTER_API_KEY" if (ENV["OPENROUTER_API_KEY"].to_s.empty? && !(File.exist?(File.join(Dir.pwd, ".env"))))
    
    require "aura/kernel"
    runner = Aura::Kernel::Runner.new(@app)
    plan = runner.plan("请直接使用 read_file 工具读取 config/config.yml，不要使用其他工具。")
    if plan[:type] == "tool_call"
      assert_equal "read_file", plan[:tool]
      assert_equal "config/config.yml", plan[:args]["file_path"]
    else
      assert_equal "text", plan[:type]
      assert plan[:content].to_s.strip.length > 0
    end
  end
end

