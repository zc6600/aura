require "minitest/autorun"
require "aura/context/lsp_provider"
require "aura/ext/lsp/manager"

class TestLSPProvider < Minitest::Test
  def setup
    @project_path = "/tmp/aura_lsp_test"
    @manager = Aura::LSP::Manager.new(@project_path)
    @provider = Aura::Context::LSPProvider.new(@project_path, @manager)
  end

  def test_provide_empty_diagnostics
    assert_equal "", @provider.provide
  end

  def test_provide_with_errors
    params = {
      "uri" => "file://#{@project_path}/logic.py",
      "diagnostics" => [{ 
        "severity" => 1, 
        "message" => "Unexpected token", 
        "range" => { "start" => { "line" => 4, "character" => 2 } } 
      }]
    }
    @manager.send(:update_diagnostics, params)
    
    output = @provider.provide
    assert_includes output, "# CODE HEALTH"
    assert_includes output, "logic.py: 1 errors"
    assert_includes output, "[L5] Error: Unexpected token"
  end
end
