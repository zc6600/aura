require "minitest/autorun"
require "fileutils"

class TestApiKeyResolution < Minitest::Test
  def setup
    @proj = File.join(Dir.pwd, "tmp_api_key_resolve")
    FileUtils.rm_rf(@proj)
    FileUtils.mkdir_p(@proj)
    File.write(File.join(@proj, ".env"), <<~ENV)
      AURA_LLM_API_KEY=sk-global
      OPENROUTER_API_KEY=sk-openrouter
      AZURE_OPENAI_API_KEY=sk-azure
    ENV
    @prev = ENV.to_hash
    ENV.delete("AURA_LLM_API_KEY")
    ENV.delete("OPENROUTER_API_KEY")
    ENV.delete("AZURE_OPENAI_API_KEY")
  end

  def teardown
    ENV.clear
    @prev.each { |k, v| ENV[k] = v }
    FileUtils.rm_rf(@proj)
  end

  def test_vendor_specific_precedence
    require "aura/llm/env"
    Aura::LLM::Env.load_from(@proj)
    key = Aura::LLM::Env.resolve_api_key("openrouter")
    assert_equal "sk-openrouter", key
  end

  def test_fallback_to_global
    require "aura/llm/env"
    Aura::LLM::Env.load_from(@proj)
    key = Aura::LLM::Env.resolve_api_key("mistral")
    assert_equal "sk-global", key
  end

  def test_provider_name_normalization
    require "aura/llm/env"
    Aura::LLM::Env.load_from(@proj)
    key = Aura::LLM::Env.resolve_api_key("azure_openai")
    assert_equal "sk-azure", key
  end
end

