require "minitest/autorun"
require "aura/context/env_provider/lsp_provider"
require "json"

class TestLSPProvider < Minitest::Test
  def setup
    @project_path = "/mock/project"
  end

  def test_provide_empty_when_no_manager
    provider = Aura::Context::EnvProvider::LSPProvider.new(@project_path, nil)
    assert_equal "", provider.provide
  end

  class MockLSPManager
    attr_accessor :diagnostics
    def get_diagnostics
      @diagnostics
    end
  end

  def test_provide_diagnostics_formatting
    mock_manager = MockLSPManager.new
    mock_manager.diagnostics = {
      "file:///mock/project/lib/test.rb" => [
        {
          "severity" => 1,
          "message" => "syntax error",
          "range" => { "start" => { "line" => 10, "character" => 5 } }
        },
        {
          "severity" => 2,
          "message" => "unused variable",
          "range" => { "start" => { "line" => 20, "character" => 1 } }
        }
      ]
    }
    
    provider = Aura::Context::EnvProvider::LSPProvider.new(@project_path, mock_manager)
    out = provider.provide
    
    assert_includes out, "# CODE HEALTH (LSP Diagnostics)"
    assert_includes out, "lib/test.rb: 1 errors, 1 warnings"
    assert_includes out, "[L11] Error: syntax error"
  end
end
