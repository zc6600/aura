# frozen_string_literal: true

require "test_helper"
require "aura/kernel/registry"
require "tmpdir"
require "fileutils"
require "json"

class TestToolRegistry < Minitest::Test
  def setup
    @tmpdir = Dir.mktmpdir("aura-registry-test")
    @tools_path = File.join(@tmpdir, "tools")
    Dir.mkdir(@tools_path)
  end

  def teardown
    FileUtils.rm_rf(@tmpdir)
  end

  # Test 1: Empty registry when no tools exist
  def test_empty_registry_when_no_tools
    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)

    assert_equal [], registry.all_tools
    assert_nil registry.find("nonexistent")
  end

  # Test 2: Register standalone tool
  def test_register_standalone_tool
    create_tool("bash", {
      "name" => "bash",
      "description" => "Run bash commands",
      "parameters" => { "command" => "string" }
    })

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)

    assert_includes registry.all_tools, "bash"
    tool = registry.find("bash")
    assert_equal "bash", tool[:manifest]["name"]
    assert_nil tool[:group]
  end

  # Test 3: Multiple standalone tools
  def test_multiple_standalone_tools
    create_tool("bash", { "name" => "bash" })
    create_tool("read_file", { "name" => "read_file" })
    create_tool("write_file", { "name" => "write_file" })

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)

    assert_equal 3, registry.all_tools.length
    assert_includes registry.all_tools, "bash"
    assert_includes registry.all_tools, "read_file"
    assert_includes registry.all_tools, "write_file"
  end

  # Test 4: Tool uses directory name if manifest missing name
  def test_tool_uses_directory_name_if_manifest_missing_name
    create_tool("my_custom_tool", {
      "description" => "No name field"
    })

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)

    assert_includes registry.all_tools, "my_custom_tool"
  end

  # Test 5: Tool directory without manifest.json ignored
  def test_tool_directory_without_manifest_ignored
    tool_dir = File.join(@tools_path, "incomplete_tool")
    Dir.mkdir(tool_dir)
    # No manifest.json created

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)

    refute_includes registry.all_tools, "incomplete_tool"
  end

  # Test 6: Register tool group with entry and subtools
  def test_register_tool_group
    create_tool_group("browser", "browser", "navigate", ["click", "type", "screenshot"])

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)

    # All tools from group should be registered
    assert_includes registry.all_tools, "navigate"
    assert_includes registry.all_tools, "click"
    assert_includes registry.all_tools, "type"
    assert_includes registry.all_tools, "screenshot"

    # All should belong to "browser" group
    assert_equal "browser", registry.group_for("navigate")
    assert_equal "browser", registry.group_for("click")
    assert_equal "browser", registry.group_for("type")
    assert_equal "browser", registry.group_for("screenshot")
  end

  # Test 7: Group without entry_tool still registers subtools
  def test_group_without_entry_tool_still_registers_subtools
    create_tool_group_no_entry("files", ["read", "write", "delete"])

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)

    refute_includes registry.all_tools, "entry"  # No entry tool
    assert_includes registry.all_tools, "read"
    assert_includes registry.all_tools, "write"
    assert_includes registry.all_tools, "delete"
  end

  # Test 8: Invalid group manifest skipped
  def test_invalid_group_manifest_skipped
    group_dir = File.join(@tools_path, "broken_group")
    Dir.mkdir(group_dir)
    File.write(File.join(group_dir, "group_manifest.json"), "invalid json {{{")

    # Should not raise
    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)
    assert true
  end

  # Test 9: Invalid tool manifest skipped
  def test_invalid_tool_manifest_skipped
    tool_dir = File.join(@tools_path, "broken_tool")
    Dir.mkdir(tool_dir)
    File.write(File.join(tool_dir, "manifest.json"), "not valid json")

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)

    refute_includes registry.all_tools, "broken_tool"
  end

  # Test 10: find returns nil for nonexistent tool
  def test_find_returns_nil_for_nonexistent
    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)

    assert_nil registry.find("does_not_exist")
  end

  # Test 11: group_for returns nil for standalone tool
  def test_group_for_returns_nil_for_standalone
    create_tool("standalone", { "name" => "standalone" })

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)

    assert_nil registry.group_for("standalone")
  end

  # Test 12: Hot refresh when files change
  def test_hot_refresh_when_files_change
    # Initial scan
    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)
    assert_equal 0, registry.all_tools.length

    # Add new tool after initialization
    sleep 1.1  # Ensure mtime is different
    create_tool("new_tool", { "name" => "new_tool" })

    # Should detect new tool on next find/all_tools call
    tools = registry.all_tools
    assert_includes tools, "new_tool"
  end

  # Test 13: No refresh when files unchanged
  def test_no_refresh_when_files_unchanged
    create_tool("existing", { "name" => "existing" })

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)
    initial_tools = registry.all_tools

    # Call again immediately (no file changes)
    tools_after = registry.all_tools

    assert_equal initial_tools.sort, tools_after.sort
  end

  # Test 14: Multiple groups
  def test_multiple_groups
    create_tool_group("browser", "browser", "navigate", ["click"])
    create_tool_group("files", "files", "list", ["read", "write"])

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)

    assert_equal "browser", registry.group_for("navigate")
    assert_equal "browser", registry.group_for("click")
    assert_equal "files", registry.group_for("list")
    assert_equal "files", registry.group_for("read")
    assert_equal "files", registry.group_for("write")
  end

  # Test 15: Tool info contains path and manifest
  def test_tool_info_contains_path_and_manifest
    manifest = {
      "name" => "test_tool",
      "description" => "Test description",
      "parameters" => { "arg1" => "string" }
    }
    create_tool("test_tool", manifest)

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)
    tool = registry.find("test_tool")

    assert_equal @tmpdir, File.dirname(File.dirname(tool[:path]))
    assert_equal manifest, tool[:manifest]
    assert_equal "test_tool", tool[:manifest]["name"]
  end

  # Test 16: Scan! forces re-scan
  def test_scan_forces_rescan
    create_tool("tool1", { "name" => "tool1" })

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)
    assert_includes registry.all_tools, "tool1"

    # Add another tool
    create_tool("tool2", { "name" => "tool2" })

    # Force re-scan
    registry.scan!

    assert_includes registry.all_tools, "tool1"
    assert_includes registry.all_tools, "tool2"
  end

  # Test 17: Nonexistent project path handled gracefully
  def test_nonexistent_project_path_handled
    nonexistent = File.join(@tmpdir, "nonexistent_project")

    # Should not raise
    registry = Aura::Kernel::ToolRegistry.new(nonexistent)
    assert_equal [], registry.all_tools
  end

  # Test 18: Tool with complex manifest
  def test_tool_with_complex_manifest
    complex_manifest = {
      "name" => "complex_tool",
      "description" => "A complex tool",
      "version" => "1.0.0",
      "parameters" => {
        "required" => ["arg1"],
        "properties" => {
          "arg1" => { "type" => "string", "description" => "First arg" },
          "arg2" => { "type" => "number", "description" => "Second arg" }
        }
      },
      "metadata" => {
        "author" => "test",
        "tags" => ["test", "example"]
      }
    }

    create_tool("complex_tool", complex_manifest)

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)
    tool = registry.find("complex_tool")

    assert_equal complex_manifest, tool[:manifest]
    assert_equal "1.0.0", tool[:manifest]["version"]
    assert_equal ["test", "example"], tool[:manifest]["metadata"]["tags"]
  end

  # Test 19: Group name from group_manifest
  def test_group_name_from_manifest
    create_tool_group("my_group", "custom_group_name", "entry", ["sub1"])

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)

    # Tools should be registered with custom group name
    assert_equal "custom_group_name", registry.group_for("entry")
    assert_equal "custom_group_name", registry.group_for("sub1")
  end

  # Test 20: Empty subtools list
  def test_empty_subtools_list
    group_dir = File.join(@tools_path, "minimal_group")
    Dir.mkdir(group_dir)
    File.write(File.join(group_dir, "group_manifest.json"), JSON.generate({
      "group_name" => "minimal",
      "entry_tool" => "entry"
      # No subtools key
    }))

    create_tool_in_group("minimal_group", "entry", { "name" => "entry" })

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)

    assert_includes registry.all_tools, "entry"
    assert_equal 1, registry.all_tools.length
  end

  # Test 21: Nested standalone tool registration (e.g. tools/category/subcategory/tool)
  def test_nested_standalone_tool
    nested_dir = File.join(@tools_path, "category", "subcategory", "my_nested_tool")
    FileUtils.mkdir_p(nested_dir)
    File.write(File.join(nested_dir, "manifest.json"), JSON.generate({
      "name" => "my_nested_tool",
      "description" => "A nested tool"
    }))

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)

    assert_includes registry.all_tools, "my_nested_tool"
    tool = registry.find("my_nested_tool")
    assert_equal "my_nested_tool", tool[:manifest]["name"]
    assert_nil tool[:group]
  end

  # Test 22: Nested group manifest registration
  def test_nested_group_tool
    nested_group_dir = File.join(@tools_path, "category", "my_group")
    FileUtils.mkdir_p(nested_group_dir)
    File.write(File.join(nested_group_dir, "group_manifest.json"), JSON.generate({
      "group_name" => "nested_group",
      "entry_tool" => "open",
      "subtools" => ["click"]
    }))

    # Create entry tool
    open_dir = File.join(nested_group_dir, "open")
    FileUtils.mkdir_p(open_dir)
    File.write(File.join(open_dir, "manifest.json"), JSON.generate({ "name" => "nested_open" }))

    # Create subtool
    click_dir = File.join(nested_group_dir, "click")
    FileUtils.mkdir_p(click_dir)
    File.write(File.join(click_dir, "manifest.json"), JSON.generate({ "name" => "nested_click" }))

    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)

    assert_includes registry.all_tools, "nested_open"
    assert_includes registry.all_tools, "nested_click"
    assert_equal "nested_group", registry.group_for("nested_open")
    assert_equal "nested_group", registry.group_for("nested_click")
  end

  # Test 23: Hot refresh on nested tool changes
  def test_nested_hot_refresh
    registry = Aura::Kernel::ToolRegistry.new(@tmpdir)
    assert_equal 0, registry.all_tools.length

    sleep 1.1 # Ensure mtime difference
    nested_dir = File.join(@tools_path, "category", "subcategory", "new_nested_tool")
    FileUtils.mkdir_p(nested_dir)
    File.write(File.join(nested_dir, "manifest.json"), JSON.generate({ "name" => "new_nested_tool" }))

    assert_includes registry.all_tools, "new_nested_tool"
  end

  private

  def create_tool(name, manifest)
    tool_dir = File.join(@tools_path, name)
    Dir.mkdir(tool_dir)
    File.write(File.join(tool_dir, "manifest.json"), JSON.generate(manifest))
  end

  def create_tool_group(dir_name, group_name, entry_tool, subtools)
    group_dir = File.join(@tools_path, dir_name)
    Dir.mkdir(group_dir)

    # Create group manifest
    File.write(File.join(group_dir, "group_manifest.json"), JSON.generate({
      "group_name" => group_name,
      "entry_tool" => entry_tool,
      "subtools" => subtools
    }))

    # Create entry tool
    create_tool_in_group(dir_name, entry_tool, { "name" => entry_tool })

    # Create subtools
    subtools.each do |subtool|
      create_tool_in_group(dir_name, subtool, { "name" => subtool })
    end
  end

  def create_tool_group_no_entry(dir_name, subtools)
    group_dir = File.join(@tools_path, dir_name)
    Dir.mkdir(group_dir)

    File.write(File.join(group_dir, "group_manifest.json"), JSON.generate({
      "group_name" => dir_name,
      "subtools" => subtools
    }))

    subtools.each do |subtool|
      create_tool_in_group(dir_name, subtool, { "name" => subtool })
    end
  end

  def create_tool_in_group(group_dir, tool_name, manifest)
    tool_dir = File.join(@tools_path, group_dir, tool_name)
    Dir.mkdir(tool_dir)
    File.write(File.join(tool_dir, "manifest.json"), JSON.generate(manifest))
  end
end
