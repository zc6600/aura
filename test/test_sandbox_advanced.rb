require "minitest/autorun"
require "aura/kernel/execution_engine"
require "json"
require "fileutils"
require "yaml"

class TestSandboxAdvanced < Minitest::Test
  def setup
    @project_path = File.expand_path("tmp_sandbox_advanced")
    FileUtils.rm_rf(@project_path)
    FileUtils.mkdir_p(File.join(@project_path, "config"))
    FileUtils.mkdir_p(File.join(@project_path, "tools", "test_tool"))
    
    # Create a simple Python tool
    File.write(File.join(@project_path, "tools", "test_tool", "logic.py"), "print('ok')")
    File.write(File.join(@project_path, "tools", "test_tool", "manifest.json"), {
      name: "test_tool",
      runtime: "python3",
      entry: "logic.py"
    }.to_json)
  end

  def teardown
    FileUtils.rm_rf(@project_path)
  end

  def test_sandbox_config_loading
    config = {
      "security" => {
        "sandbox" => {
          "enabled" => true,
          "provider" => "docker",
          "image" => "custom-image:v1"
        }
      }
    }
    File.write(File.join(@project_path, "config", "config.yml"), config.to_yaml)
    
    engine = Aura::Kernel::ExecutionEngine.new(@project_path)
    # We can't easily verify the private apply_sandbox without a mock, 
    # but we can verify that the configuration is at least loaded properly.
    assert engine.send(:load_full_config)["security"]["sandbox"]["enabled"]
  end

  def test_sandbox_disabled_by_default
    File.write(File.join(@project_path, "config", "config.yml"), {}.to_yaml)
    engine = Aura::Kernel::ExecutionEngine.new(@project_path)
    cfg = engine.send(:load_full_config)
    refute cfg.dig("security", "sandbox", "enabled")
  end
end
