require "minitest/autorun"
require "yaml"

class TestConfigSchema < Minitest::Test
  def test_config_keys
    path = File.expand_path("../../lib/aura/generators/aura/app/templates/config.yml", __dir__)
    data = YAML.load_file(path)
    %w[system state_management tool_protocol security hints].each do |k|
      assert data.key?(k), "missing #{k}"
    end
    assert data["state_management"]["max_state_chars"].is_a?(Integer)
    %w[python ruby shell].each do |rt|
      assert data["tool_protocol"]["runtimes"].key?(rt)
    end
  end
end

