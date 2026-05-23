require "minitest/autorun"
require "stringio"
require "fileutils"

class TestKernelPlanCli < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_kernel_plan")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_kernel_plan")
    
    require "aura/llm/client"
    @mock_client_class = Class.new do
      def initialize(*args); end
      def complete(messages, options = {})
        { content: '{"tool": "read_file", "args": {"file_path": "test.txt"}}', finish_reason: "stop" }
      end
    end
    
    mock_class = @mock_client_class
    class << Aura::LLM::Client
      alias_method :original_new, :new
    end
    Aura::LLM::Client.define_singleton_method(:new) do |*args|
      mock_class.new
    end
  end

  def teardown
    class << Aura::LLM::Client
      alias_method :new, :original_new
      remove_method :original_new
    end
    FileUtils.rm_rf(@app)
  end

  def test_kernel_plan_returns_tool_call
    require "aura/cli/commands/kernel_command"
    out = StringIO.new
    begin
      $stdout = out
      Aura::Commands::KernelCommand.start(["plan", @app, "-H"]) 
    ensure
      $stdout = STDOUT
    end
    s = out.string
    assert_includes s, "== Plan =="
    assert_match /"tool":"[^"]+"/, s
  end
end

