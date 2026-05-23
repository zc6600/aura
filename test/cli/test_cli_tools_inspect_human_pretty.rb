require "minitest/autorun"
require "stringio"
require "fileutils"
require "aura/cli/entry"

class TestCliToolsInspectFormats < Minitest::Test
  def setup
    # Use an absolute path anchored to this file's location so the path is
    # immune to Dir.pwd pollution from other tests doing Dir.chdir without restore.
    @project_root = File.expand_path("../..", __dir__)
    @app = File.join(@project_root, "tmp_cli_tool_formats")
    FileUtils.rm_rf(@app)
    # Array form avoids shell word-splitting on paths that contain spaces.
    system("ruby", File.join(@project_root, "bin", "aura"), "new", "tmp_cli_tool_formats",
           chdir: @project_root)
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_pretty_json_output
    Dir.chdir(@app) do
      out = StringIO.new
      begin
        $stdout = out
        Aura::Commands::ToolsCommand.start(["inspect", "inspect_tool", "--pretty"])
      ensure
        $stdout = STDOUT
      end
      s = out.string
      assert_includes s, "\n  \"tool\""
    end
  end

  def test_human_output
    Dir.chdir(@app) do
      out = StringIO.new
      begin
        $stdout = out
        Aura::Commands::ToolsCommand.start(["inspect", "inspect_tool", "--human"])
      ensure
        $stdout = STDOUT
      end
      s = out.string
      assert_includes s, "Tool: inspect_tool"
      assert_includes s, "Files:"
    end
  end
end
