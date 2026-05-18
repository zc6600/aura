require "minitest/autorun"
require "aura/ext/mcp/manager"
require "json"

class TestMCPManager < Minitest::Test
  def setup
    @project_path = File.expand_path("tmp_mcp_test")
    FileUtils.mkdir_p(@project_path)
  end

  def teardown
    FileUtils.rm_rf(@project_path)
  end

  def test_manager_initialization
    manager = Aura::MCP::Manager.new(@project_path)
    assert_kind_of Aura::MCP::Manager, manager
  end

  def test_mcp_tool_detection
    manager = Aura::MCP::Manager.new(@project_path)
    # By default, no tools should be detected unless configured
    refute manager.mcp_tool?("non_existent_tool")
  end
end
