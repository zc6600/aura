require "minitest/autorun"
require "fileutils"
require "aura/kernel"

class TestKernelLSPIntegration < Minitest::Test
  def setup
    @project_path = File.join(Dir.pwd, "tmp_integration_lsp")
    FileUtils.rm_rf(@project_path)
    system("ruby bin/aura new \"#{@project_path}/\"")
  end

  def teardown
    FileUtils.rm_rf(@project_path)
  end

  def test_observe_includes_lsp_diagnostics
    runner = Aura::Kernel::Runner.new(@project_path)
    # Manually inject a fake diagnostic into the manager since we don't want to depend on solargraph in CI
    manager = runner.instance_variable_get(:@lsp_manager)
    
    params = {
      "uri" => "file://#{@project_path}/logic.py",
      "diagnostics" => [{ 
        "severity" => 1, 
        "message" => "Integration Test Error", 
        "range" => { "start" => { "line" => 10, "character" => 5 } } 
      }]
    }
    manager.send(:update_diagnostics, params)
    
    context = runner.observe
    assert_includes context, "# CODE HEALTH"
    assert_includes context, "Integration Test Error"
    assert_includes context, "logic.py: 1 errors"
  end
end
