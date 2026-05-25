# frozen_string_literal: true

require "test_helper"
require "tmpdir"
require "fileutils"
require "open3"
require "aura/kernel/ralph_loop"
require "aura/kernel/event_bus"

class TestRalphLoop < Minitest::Test
  class MockLLMClient
    attr_accessor :responses
    
    def initialize
      @responses = []
      @idx = 0
    end
    
    def complete(messages, options = {})
      res = @responses[@idx] || @responses.last
      @idx += 1
      res
    end
  end

  class MockPayload
    def to_tool_schemas
      []
    end
    def to_markdown_excluding(keys)
      "mock_workspace_state"
    end
  end

  class MockPlanner
    attr_reader :client, :temp, :max_tokens
    def initialize(client)
      @client = client
      @temp = 0.2
      @max_tokens = 4000
    end
  end

  class MockRunner
    attr_reader :planner, :events, :hooks
    
    def initialize(client, project_path)
      @client = client
      @project_path = project_path
      @env_path = File.join(project_path, ".aura")
      @planner = MockPlanner.new(client)
      @events = []
      @hooks = Aura::Kernel::Hooks.new
    end
    def reconnect_session!(session_name)
    end
    def observe
      MockPayload.new
    end
    def start_job(input:, auto_mode:)
    end
    def run_call(call)
      { "status" => "ok", "output" => "mock tool run ok" }
    end
    def end_job(status)
    end
    def emit(event, payload = {})
      @events << { event: event, payload: payload }
    end
    def load_config
      {
        "ralph" => {
          "max_steps" => 10,
          "verify_command" => "echo test",
          "use_critic" => false
        }
      }
    end
    def plan_stream(goal = nil, context = nil)
      res = @client.complete(nil)
      content = res[:content] || ""
      parsed = Aura::LLM::Parsers::ResponseParser.parse(res[:raw] || res[:content] || content)
      parsed[:finish_reason] = res[:finish_reason]
      parsed[:raw_content] = content
      
      # Yield delta event to simulate streaming if block given
      yield({ type: "delta", text: content }) if block_given?
      
      parsed
    end
  end

  class MockStatus
    def initialize(success_val)
      @success_val = success_val
    end
    def success?
      @success_val
    end
  end

  def setup
    @project_path = Dir.mktmpdir("aura_test")
    @env_path = File.join(@project_path, ".aura")
    FileUtils.mkdir_p(File.join(@env_path, "config"))
    
    # Write a base config.yml
    File.write(
      File.join(@env_path, "config", "config.yml"),
      <<~YAML
        ralph:
          max_steps: 10
          verify_command: "echo test"
          use_critic: false
        llm:
          provider: "local"
      YAML
    )
    
    @mock_client = MockLLMClient.new
    @mock_runner = MockRunner.new(@mock_client, @project_path)
  end

  def teardown
    FileUtils.rm_rf(@project_path)
  end

  # Helper to stub a singleton class method in pure Ruby
  def stub_singleton(klass, method_name, mock_value_or_callable)
    original_method = klass.method(method_name)
    klass.define_singleton_method(method_name) do |*args, &block|
      if mock_value_or_callable.respond_to?(:call)
        mock_value_or_callable.call(*args, &block)
      else
        mock_value_or_callable
      end
    end
    yield
  ensure
    klass.define_singleton_method(method_name, &original_method)
  end

  # Test 1: Completes immediately when physical test passes and agent calls final
  def test_physical_verify_passes_immediately
    @mock_client.responses = [
      { content: '{"tool": "final", "args": {"content": "Task completed"}, "summary": "Done"}', finish_reason: "stop" }
    ]
    
    mock_status = MockStatus.new(true)
    
    stub_singleton(Open3, :capture3, ["test output", "", mock_status]) do
      loop_inst = Aura::Kernel::RalphLoop.new(@mock_runner, "fix bug")
      result = loop_inst.run
      
      assert_equal :completed, result
    end
  end

  # Test 2: Fails first physical test, succeeds on second iteration
  def test_physical_verify_fails_once_then_succeeds
    @mock_client.responses = [
      { content: '{"tool": "final", "args": {"content": "First try"}, "summary": "Finishing"}', finish_reason: "stop" },
      { content: '{"tool": "final", "args": {"content": "Second try"}, "summary": "Finishing again"}', finish_reason: "stop" }
    ]
    
    status_fail = MockStatus.new(false)
    status_ok = MockStatus.new(true)

    call_count = 0
    capture3_stub = lambda do |*args|
      call_count += 1
      if call_count <= 2
        ["failed test log", "some error", status_fail]
      else
        ["success log", "", status_ok]
      end
    end

    stub_singleton(Open3, :capture3, capture3_stub) do
      loop_inst = Aura::Kernel::RalphLoop.new(@mock_runner, "fix bug")
      result = loop_inst.run
      
      assert_equal :completed, result
      assert_equal 3, call_count
    end
  end

  # Test 3: Critic LLM rejects first attempt, accepts second attempt
  def test_critic_rejects_first_then_accepts
    @mock_client.responses = [
      { content: '{"tool": "read_file", "args": {"path": "a.txt"}, "summary": "reading"}', finish_reason: "tool_calls" },
      { content: '{"completed": false, "critique": "not fixed yet", "advice": "edit file"}', finish_reason: "stop" },
      { content: '{"tool": "final", "args": {"content": "fixed"}, "summary": "done"}', finish_reason: "stop" },
      { content: '{"completed": true, "critique": "perfect", "advice": ""}', finish_reason: "stop" }
    ]

    loop_inst = Aura::Kernel::RalphLoop.new(@mock_runner, "fix code", critic: true)
    result = loop_inst.run
    
    assert_equal :completed, result

    # Verify that the critique report was written to disk
    audit_file = File.join(@env_path, "state", "critic_audit.md")
    assert File.exist?(audit_file)
    audit_content = File.read(audit_file)
    assert_match(/Status\*\*: PASSING/, audit_content)
    assert_match(/perfect/, audit_content)
  end

  # Test 4: Aborts when max steps limit is exceeded
  def test_aborts_on_max_steps
    @mock_client.responses = [
      { content: '{"tool": "read_file", "args": {"path": "a.txt"}, "summary": "looping"}', finish_reason: "tool_calls" }
    ] * 10
    
    loop_inst = Aura::Kernel::RalphLoop.new(@mock_runner, "endless goal", max_steps: 3)
    result = loop_inst.run
    
    assert_equal :failed, result
  end

  # Test 5: Completes immediately when agent returns plain text and test passes
  def test_plain_text_verify_passes
    # Agent replies with a text description instead of a JSON tool call
    @mock_client.responses = [
      { content: 'Here is your completed solution: OK', finish_reason: "stop" }
    ]
    
    mock_status = MockStatus.new(true)
    
    stub_singleton(Open3, :capture3, ["test output", "", mock_status]) do
      loop_inst = Aura::Kernel::RalphLoop.new(@mock_runner, "fix bug")
      result = loop_inst.run
      
      assert_equal :completed, result
    end
  end
end
