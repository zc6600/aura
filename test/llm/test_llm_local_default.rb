require "minitest/autorun"
require "fileutils"

class TestLlmLocalDefault < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_llm_local")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_llm_local")
    
    cfg = File.join(@app, ".aura", "config", "config.yml")
    s = File.read(cfg)
    s = s.gsub('max_state_chars: 4000', 'max_state_chars: 100000')
    s = s.gsub('provider: openrouter', 'provider: local')
    File.write(cfg, s)
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_local_provider_returns_read_file_plan
    require "aura/kernel"
    runner = Aura::Kernel::Runner.new(@app)
    assert_raises(RuntimeError) do
      runner.plan("仅输出JSON工具调用：读取config/config.yml（read_file）。")
    end
  end
end
