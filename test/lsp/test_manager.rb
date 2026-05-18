require "minitest/autorun"
require "aura/ext/lsp/manager"
require "fileutils"

class TestLSPManager < Minitest::Test
  def setup
    @project_path = File.join(Dir.pwd, "tmp_lsp_test")
    FileUtils.mkdir_p(@project_path)
    @manager = Aura::LSP::Manager.new(@project_path)
  end

  def teardown
    @manager.stop_all
    FileUtils.rm_rf(@project_path)
  end

  def test_update_diagnostics
    # Directly test the private method or via notification
    params = {
      "uri" => "file://#{@project_path}/test.rb",
      "diagnostics" => [{ "severity" => 1, "message" => "Syntax error", "range" => { "start" => { "line" => 0, "character" => 0 } } }]
    }
    
    # Using send to test the internal state update
    @manager.send(:update_diagnostics, params)
    
    diags = @manager.get_diagnostics("#{@project_path}/test.rb")
    assert_equal 1, diags.size
    assert_equal "Syntax error", diags.first["message"]
  end

  def test_client_lifecycle
    # This might fail if solargraph/pyright aren't installed, 
    # so we should mock start_client or just verify it handles nil for missing configs.
    assert_nil @manager.client_for("non_existent_lang")
  end
end
