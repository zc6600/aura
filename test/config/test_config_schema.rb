require "minitest/autorun"
require "yaml"
require "fileutils"

class TestConfigSchema < Minitest::Test
  def setup
    @app = "tmp_app_config"
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new #{@app}")
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_config_keys
    data = YAML.load_file(File.join(@app, "config", "config.yml"))
    %w[system state_management tool_protocol security hints].each do |k|
      assert data.key?(k), "missing #{k}"
    end
    assert data["state_management"]["max_state_chars"].is_a?(Integer)
    %w[python ruby shell].each do |rt|
      assert data["tool_protocol"]["runtimes"].key?(rt)
    end
  end
end

