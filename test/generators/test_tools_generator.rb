# frozen_string_literal: true

require "minitest/autorun"
require "tmpdir"
require "fileutils"
require "aura/generators/tools_generator"

class TestToolsGenerator < Minitest::Test
  def setup
    @tmp = Dir.mktmpdir("aura_test_tools")
    @pwd = Dir.pwd
    Dir.chdir(@tmp)
    FileUtils.mkdir_p("tools")
    
    # Mock template directory
    @mock_template_dir = File.join(@tmp, "templates")
    FileUtils.mkdir_p(File.join(@mock_template_dir, "dummy_tool"))
    File.write(File.join(@mock_template_dir, "dummy_tool", "manifest.json"), '{"name": "dummy"}')
  end

  def teardown
    Dir.chdir(@pwd)
    FileUtils.remove_entry(@tmp)
  end

  def test_add_tool_success
    Aura::Generators::ToolsGenerator.define_singleton_method(:source_root) { @mock_sroot }
    Aura::Generators::ToolsGenerator.instance_variable_set(:@mock_sroot, @mock_template_dir)

    out, _err = capture_io do
      Aura::Generators::ToolsGenerator.start(["dummy_tool"])
    end
    
    assert File.exist?("tools/dummy_tool/manifest.json")
    assert_match /Tool 'dummy_tool' installed successfully!/, out
  end

  def test_add_tool_failure_not_found
    Aura::Generators::ToolsGenerator.define_singleton_method(:source_root) { @mock_sroot }
    Aura::Generators::ToolsGenerator.instance_variable_set(:@mock_sroot, @mock_template_dir)

    _out, err = capture_io do
      # Thor catches Thor::Error and exits. We want to ensure it fails.
      begin
        Aura::Generators::ToolsGenerator.start(["non_existent_tool"])
      rescue SystemExit
      end
    end
    assert_match /Tool 'non_existent_tool' not found/, err
  end
end
