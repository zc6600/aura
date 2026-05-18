require "minitest/autorun"
require "fileutils"

class TestLlmOpenAIIntegration < Minitest::Test
  def setup
    skip "set RUN_REAL_LLM_TESTS=1 to run" unless ENV["RUN_REAL_LLM_TESTS"] == "1"
    skip "missing OPENAI_API_KEY" if (ENV["OPENAI_API_KEY"].to_s.empty? && !(File.exist?(File.join(Dir.pwd, ".env"))))
    @app = File.join(Dir.pwd, "tmp_openai_real")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_openai_real")
    root_env = File.join(Dir.pwd, ".env")
    FileUtils.cp(root_env, File.join(@app, ".env")) if File.exist?(root_env)
    cfg = File.join(@app, "config", "config.yml")
    s = File.read(cfg)
    s = s.gsub('provider: "local"', 'provider: "openai"')
    s = s.gsub('model: "gpt-4o"', 'model: "gpt-4o-mini"')
    s = s.gsub('max_state_chars: 4000', 'max_state_chars: 100000')
    s = s.gsub('max_tokens: 512', 'max_tokens: 1024')
    File.write(cfg, s)
  end

  def teardown
    FileUtils.rm_rf(@app) if @app
  end

  def test_plan_returns_text_or_tool_call
    skip "not running real test" unless ENV["RUN_REAL_LLM_TESTS"] == "1"
    require "aura/cli/commands/kernel_command"
    out = `bin/aura kernel plan #{@app} -g "仅输出JSON工具调用：读取config/config.yml（read_file）。"`
    assert out.to_s.length > 0
  end
end

