require "minitest/autorun"
require "stringio"
require "fileutils"
require "aura/cli/entry"

class TestCliToolsInspect < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_cli_tool_inspect")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_cli_tool_inspect")
    
    require "aura/cli/commands/tools_command"
    Aura::Commands::ToolsCommand.class_eval do
      alias_method :original_tool_inspect, :tool_inspect
    end
  end

  def teardown
    if Aura::Commands::ToolsCommand.method_defined?(:original_tool_inspect)
      Aura::Commands::ToolsCommand.class_eval do
        alias_method :tool_inspect, :original_tool_inspect
        remove_method :original_tool_inspect
      end
    end
    FileUtils.rm_rf(@app)
  end

  def test_tools_inspect_prints_json
    Dir.chdir(@app) do
      Aura::Commands::ToolsCommand.class_eval do
        def tool_inspect(name)
          puts({ tool: name }.to_json)
        end
      end
      out = StringIO.new
      begin
        $stdout = out
        Aura::Commands::ToolsCommand.start(["inspect", "inspect_tool"]) 
      ensure
        $stdout = STDOUT
      end
      s = out.string
      assert_includes s, "\"tool\":\"inspect_tool\""
    end
  end
end
