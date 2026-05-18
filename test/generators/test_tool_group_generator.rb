# frozen_string_literal: true

require "minitest/autorun"
require "tmpdir"
require "fileutils"
require "json"
require "aura/generators/tool_group_generator"

class TestToolGroupGenerator < Minitest::Test
  def setup
    @tmp = Dir.mktmpdir("aura_test_tool_group")
    @pwd = Dir.pwd
    Dir.chdir(@tmp)
    FileUtils.mkdir_p("tools")
  end

  def teardown
    Dir.chdir(@pwd)
    FileUtils.remove_entry(@tmp)
  end

  def test_generates_correct_structure
    Aura::Generators::ToolGroupGenerator.start(["browser", "click", "screenshot"])

    assert Dir.exist?("tools/browser")
    assert File.exist?("tools/browser/group_manifest.json")
    
    # Check group manifest
    group_manifest = JSON.parse(File.read("tools/browser/group_manifest.json"))
    assert_equal "browser", group_manifest["group_name"]
    assert_equal "open", group_manifest["entry_tool"]
    assert_includes group_manifest["subtools"], "click"
    assert_includes group_manifest["subtools"], "screenshot"
    assert_includes group_manifest["subtools"], "close"

    # Check tools
    assert Dir.exist?("tools/browser/open")
    assert Dir.exist?("tools/browser/click")
    assert Dir.exist?("tools/browser/close")

    # Check manifest content for subtool
    click_manifest = JSON.parse(File.read("tools/browser/click/manifest.json"))
    assert_equal "browser_click", click_manifest["name"]
    assert_equal "browser_session", click_manifest["requires_context"]
    assert_includes click_manifest["input_schema"]["required"], "context_id"
  end

  def test_entry_tool_auto_loads
    Aura::Generators::ToolGroupGenerator.start(["search"])
    open_manifest = JSON.parse(File.read("tools/search/open/manifest.json"))
    assert open_manifest["auto_load"], "Entry tool should be auto_load: true"
    assert_equal "search_session", open_manifest["creates_context"]
  end

  def test_close_tool_destroys_context
    Aura::Generators::ToolGroupGenerator.start(["db"])
    close_manifest = JSON.parse(File.read("tools/db/close/manifest.json"))
    assert close_manifest["destroys_context"], "Close tool should be destroys_context: true"
  end
end
