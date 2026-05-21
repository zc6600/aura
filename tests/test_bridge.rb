# frozen_string_literal: true

require "minitest/autorun"
require "aura/interface/bridge"
require "aura/kernel/agent_loop"

class MockBridgeRunner
  attr_accessor :observed, :plans, :tool_results, :job_status, :job_metadata, :events_recorded
  attr_reader :hooks

  def initialize
    @observed = []
    @plans = []
    @tool_results = []
    @events_recorded = []
    @hooks = Aura::Kernel::Hooks.new
    @callbacks = {}
    @job_status = nil
    @job_metadata = nil
  end

  def record_user_input(input)
    @events_recorded << { type: :user_input, content: input }
  end

  def start_job(metadata = {})
    @job_status = :running
    @job_metadata = metadata
  end

  def end_job(status, error = nil)
    @job_status = status
  end

  def current_job
    if @job_status
      j = Struct.new(:status, :metadata).new(@job_status, @job_metadata)
      def j.status; self[:status]; end
      def j.metadata; self[:metadata]; end
      j
    else
      nil
    end
  end

  def observe
    "mock_context"
  end

  def on(event, &block)
    @callbacks[event] = block
  end

  def emit(event, payload = nil)
    @callbacks[event].call(payload) if @callbacks[event]
  end

  # Dummy configuration helper to satisfy AgentLoop
  def load_config
    {}
  end

  def plan_stream(goal, context)
    yield({ type: "delta", text: "token" })
    @plans.shift
  end

  def run_call(call)
    @tool_results.shift || { status: "success", content: "done" }
  end
end

class TestBridge < Minitest::Test
  def setup
    @runner = MockBridgeRunner.new
    # Use nil for project path since we use a mock runner
    @bridge = Aura::Interface::Bridge.new(nil, runner: @runner)
  end

  def test_callback_registration
    fired = false
    @bridge.on(:on_token) do |token|
      assert_equal "test_token", token
      fired = true
    end

    @bridge.send(:notify, :on_token, "test_token")
    assert fired
  end

  def test_successful_chat
    @runner.plans = [
      { tool: "final", args: { "content" => "Final response text" } }
    ]

    tokens = []
    final_answer = nil
    stream_ended = false

    @bridge.on(:on_token) { |t| tokens << t }
    @bridge.on(:on_final_answer) { |ans| final_answer = ans }
    @bridge.on(:on_stream_end) { stream_ended = true }

    @bridge.chat("hello world")

    assert_equal ["token"], tokens
    assert_equal "Final response text", final_answer
    assert stream_ended
    assert_equal :completed, @runner.job_status
    assert_equal({ type: :user_input, content: "hello world" }, @runner.events_recorded.first)
  end

  def test_chat_interrupt_releases_lock
    # Mock planner that raises Interrupt to simulate Ctrl+C
    def @runner.plan_stream(goal, context)
      raise Interrupt
    end

    warning = nil
    @bridge.on(:on_warning) { |w| warning = w }

    @bridge.chat("interrupt me")

    assert_equal "Interrupted by user", warning
    assert_equal :failed, @runner.job_status
  end

  def test_chat_standard_error_releases_lock
    # Mock planner that raises standard error
    def @runner.plan_stream(goal, context)
      raise StandardError.new("API failure")
    end

    error_msg = nil
    @bridge.on(:on_error) { |e| error_msg = e }

    assert_raises(StandardError) do
      @bridge.chat("cause error")
    end

    assert_equal "API failure", error_msg
    assert_equal :failed, @runner.job_status
  end

  def test_dangerous_tool_hook_interactive
    @bridge.register_confirmation_hook(["dangerous_tool"])

    confirmed = false
    @bridge.on(:ask_confirmation) do |msg|
      assert_match(/dangerous_tool/, msg)
      confirmed = true
      true
    end

    # Run the registered hook manually
    hook = @runner.hooks.instance_variable_get(:@hooks)[:before_tool_execution].first
    res = hook.call("dangerous_tool", {})

    assert res
    assert confirmed
  end

  def test_dangerous_tool_hook_auto_mode
    @bridge.register_confirmation_hook(["dangerous_tool"])
    @runner.start_job(input: "test", auto_mode: true)

    # In auto_mode, confirmation hook should automatically pass without calling ask_confirmation callback
    fired = false
    @bridge.on(:ask_confirmation) do
      fired = true
      true
    end

    hook = @runner.hooks.instance_variable_get(:@hooks)[:before_tool_execution].first
    res = hook.call("dangerous_tool", {})

    assert res
    refute fired
  end
end
