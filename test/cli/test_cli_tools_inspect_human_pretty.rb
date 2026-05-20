require "minitest/autorun"
require "stringio"
require "fileutils"
require "aura/cli/entry"

class TestCliToolsInspectFormats < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_cli_tool_formats")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_cli_tool_formats")
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_pretty_json_output
    Dir.chdir(@app) do
      out = StringIO.new
      begin
        $stdout = out
        Aura::CLI::EntryPoint.start(["tools", "inspect", "inspect_tool", "--pretty"])
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
        Aura::CLI::EntryPoint.start(["tools", "inspect", "inspect_tool", "--human"])
      ensure
        $stdout = STDOUT
      end
      s = out.string
      assert_includes s, "Tool: inspect_tool"
      assert_includes s, "Files:"
    end
  end
end
