require "minitest/autorun"
require "stringio"
require "fileutils"
require "yaml"

class TestKernelPlanOverflowCli < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_kernel_plan_overflow")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_kernel_plan_overflow")
    cfg = File.join(@app, ".aura", "config", "config.yml")
    data = YAML.load_file(cfg) || {}
    data["state_management"] ||= {}
    data["state_management"]["max_state_chars"] = 100
    File.write(cfg, data.to_yaml)
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_plan_human_overflow_preview
    require "aura/cli/commands/kernel_command"
    require "aura/llm/client"

    mock_client = Object.new
    def mock_client.complete(messages, options = {})
      { content: "== Plan ==\n1. Run task\n2. Terminate", finish_reason: "stop" }
    end

    # Pure Ruby stubbing of class method
    class << Aura::LLM::Client
      alias_method :orig_from_config, :from_config
      def from_config(*_args)
        @mock_client
      end
      attr_accessor :mock_client
    end
    Aura::LLM::Client.mock_client = mock_client

    out = StringIO.new
    begin
      $stdout = out
      Aura::Commands::KernelCommand.start(["plan", @app, "-H", "-n", "5"]) 
    ensure
      $stdout = STDOUT
      class << Aura::LLM::Client
        if method_defined?(:orig_from_config)
          alias_method :from_config, :orig_from_config
          remove_method :orig_from_config
        end
      end
    end
    s = out.string
    assert_includes s, "== Context Preview =="
    assert_includes s, "[Context overflow]"
    assert_includes s, "== Plan =="
  end
end
