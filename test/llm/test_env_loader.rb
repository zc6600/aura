require "minitest/autorun"
require "fileutils"

class TestLlmEnvLoader < Minitest::Test
  def setup
    @proj = File.join(Dir.pwd, "tmp_env_load")
    FileUtils.rm_rf(@proj)
    FileUtils.mkdir_p(@proj)
    File.write(File.join(@proj, ".env"), <<~ENV)
      # comment
      export OPENROUTER_API_KEY="sk-xyz"
      FOO=BAR
    ENV
    @prev_open = ENV["OPENROUTER_API_KEY"]
    @prev_foo  = ENV["FOO"]
    ENV.delete("OPENROUTER_API_KEY")
    ENV["FOO"] = "EXIST"
  end

  def teardown
    ENV["OPENROUTER_API_KEY"] = @prev_open
    ENV["FOO"] = @prev_foo
    FileUtils.rm_rf(@proj)
  end

  def test_env_loader_sets_missing_and_respects_existing
    require "aura/llm/env"
    Aura::LLM::Env.load_from(@proj)
    assert_equal "sk-xyz", ENV["OPENROUTER_API_KEY"]
    assert_equal "EXIST", ENV["FOO"]
  end
end

