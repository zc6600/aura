require "minitest/autorun"
require "fileutils"
require "yaml"

class TestLlmProviderFallback < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_llm_fallback")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_llm_fallback")
    
    cfg = File.join(@app, ".aura", "config", "config.yml")
    data = YAML.load_file(cfg) || {}
    data["llm"] ||= {}
    data["llm"]["provider"] = "unknown_vendor"
    data["state_management"] ||= {}
    data["state_management"]["max_state_chars"] = 100_000
    File.write(cfg, YAML.dump(data))
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_unknown_provider_falls_back_to_local
    require "aura/kernel"
    runner = Aura::Kernel::Runner.new(@app)
    assert_raises(RuntimeError) do
      runner.plan("仅输出JSON工具调用：读取config/config.yml（read_file）。")
    end
  end
end
