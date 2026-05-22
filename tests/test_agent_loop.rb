# frozen_string_literal: true

require "minitest/autorun"
require "aura/kernel/agent_loop"

class MockRunner
  attr_accessor :observe_called, :run_call_called, :plan_stream_called
  attr_accessor :mock_plans, :mock_tool_results, :mock_context

  def initialize
    @observe_called = 0
    @run_call_called = 0
    @plan_stream_called = 0
    @mock_plans = []
    @mock_tool_results = []
    @mock_context = "mock_context"
  end

  def observe
    @observe_called += 1
    @mock_context
  end

  def plan_stream(goal, context)
    @plan_stream_called += 1
    yield({ type: "delta", text: "token" })
    @mock_plans.shift
  end

  def run_call(call)
    @run_call_called += 1
    @mock_tool_results.shift || { status: "success", content: "done" }
  end
end

class TestAgentLoop < Minitest::Test
  def setup
    @runner = MockRunner.new
    @bus = Aura::Kernel::EventBus.new
    @loop = Aura::Kernel::AgentLoop.new(@runner, event_bus: @bus)
  end

  # ---------------------------------------------------------------------------
  # Happy path: tool call then natural stop
  # ---------------------------------------------------------------------------
  def test_successful_flow
    # Step 1: run bash tool. Step 2: LLM stops naturally with finish_reason "stop".
    @runner.mock_plans = [
      { tool: "bash_command", args: { "command" => "ls" }, summary: "List" },
      { type: "text", content: "Found files", finish_reason: "stop" }
    ]
    @runner.mock_tool_results = [
      { status: "success", content: "file1.txt" }
    ]

    events = []
    @bus.subscribe(:final_answer) { |payload| events << payload[:content] }

    res = @loop.run("find files")

    assert_equal :completed, res.status
    assert_equal "Found files", res.final_content
    assert_equal 1, res.steps.size
    assert_equal "bash_command", res.steps[0][:tool]
    assert_equal "file1.txt", res.steps[0][:result][:content]
    assert_equal ["Found files"], events
    assert_nil res.failure_reason
  end

  # ---------------------------------------------------------------------------
  # finish_reason "stop" without prior tool calls → immediate success
  # ---------------------------------------------------------------------------
  def test_stop_without_tool_calls
    @runner.mock_plans = [
      { type: "text", content: "Direct answer", finish_reason: "stop" }
    ]

    res = @loop.run("ask question")

    assert_equal :completed, res.status
    assert_equal "Direct answer", res.final_content
    assert_equal 0, res.steps.size
  end

  # ---------------------------------------------------------------------------
  # Format error recovery: malformed plan, then natural stop
  # ---------------------------------------------------------------------------
  def test_format_error_tolerance
    # Plan 1 is nil (format error). Plan 2 is a natural stop.
    @runner.mock_plans = [
      nil,
      { type: "text", content: "recovered", finish_reason: "stop" }
    ]

    res = @loop.run("recover format error")

    assert_equal :completed, res.status
    assert_equal "recovered", res.final_content
    assert_equal 2, @runner.plan_stream_called
  end

  # ---------------------------------------------------------------------------
  # Abort: too many consecutive format errors
  # ---------------------------------------------------------------------------
  def test_format_error_abort
    @runner.mock_plans = [nil, nil, nil, nil, nil, nil]

    aborted_event = nil
    @bus.subscribe(:loop_aborted) { |p| aborted_event = p }

    res = @loop.run("fail format")

    assert_equal :failed, res.status
    assert_equal :format_errors, aborted_event[:reason]
    assert_equal 5, @runner.plan_stream_called
    assert_equal "Max format errors reached (5)", res.failure_reason
  end

  # ---------------------------------------------------------------------------
  # Tool blocked once, then natural stop
  # ---------------------------------------------------------------------------
  def test_tool_blocked_recovery
    @runner.mock_plans = [
      { tool: "bash_command", args: { "command" => "rm -rf /" } },
      { type: "text", content: "safe answer", finish_reason: "stop" }
    ]
    @runner.mock_tool_results = [
      { status: "blocked", advice: "safety violation" }
    ]

    halted_events = []
    @bus.subscribe(:tool_halted) { |p| halted_events << p }

    res = @loop.run("run unsafe")

    assert_equal :completed, res.status
    assert_equal "safe answer", res.final_content
    assert_equal 1, halted_events.size
    assert_equal "bash_command", halted_events[0][:tool]
    assert_equal "safety violation", halted_events[0][:advice]
  end

  # ---------------------------------------------------------------------------
  # Abort: too many consecutive tool blocks
  # ---------------------------------------------------------------------------
  def test_tool_blocked_abort
    @runner.mock_plans = [
      { tool: "bash_command", args: { "command" => "rm" } },
      { tool: "bash_command", args: { "command" => "rm" } },
      { tool: "bash_command", args: { "command" => "rm" } }
    ]
    @runner.mock_tool_results = [
      { status: "blocked", advice: "fail" },
      { status: "blocked", advice: "fail" },
      { status: "blocked", advice: "fail" }
    ]

    aborted_event = nil
    @bus.subscribe(:loop_aborted) { |p| aborted_event = p }

    res = @loop.run("run unsafe loop")

    assert_equal :failed, res.status
    assert_equal :tool_errors, aborted_event[:reason]
    assert_equal 3, res.steps.size
    assert_equal "Max tool errors reached (3)", res.failure_reason
  end

  # ---------------------------------------------------------------------------
  # format_errors counter resets after a successful tool call
  # ---------------------------------------------------------------------------
  def test_format_errors_reset_on_success
    # nil (format error) → bash tool (success, resets) → nil (format error again, count=1) → stop
    @runner.mock_plans = [
      nil,
      { tool: "bash_command", args: { "command" => "ls" } },
      nil,
      { type: "text", content: "done", finish_reason: "stop" }
    ]
    @runner.mock_tool_results = [
      { status: "success", content: "file.txt" }
    ]

    res = @loop.run("test reset")

    assert_equal :completed, res.status
    assert_equal "done", res.final_content
  end

  # ---------------------------------------------------------------------------
  # Custom config limits
  # ---------------------------------------------------------------------------
  def test_custom_config_limits
    def @runner.load_config
      {
        "system" => {
          "max_steps" => 2,
          "max_format_errors" => 2,
          "max_tool_errors" => 2
        }
      }
    end

    # 1. Test custom max_steps (limit is 2)
    @runner.mock_plans = [
      { tool: "bash_command", args: { "command" => "ls" } },
      { tool: "bash_command", args: { "command" => "ls" } },
      { type: "text", content: "done", finish_reason: "stop" }
    ]
    @runner.mock_tool_results = [
      { status: "success", content: "file.txt" },
      { status: "success", content: "file.txt" }
    ]
    res = @loop.run("test steps limit")
    assert_equal :failed, res.status
    assert_equal 2, res.steps.size
    assert_equal "Max execution steps reached (2)", res.failure_reason

    # 2. Test custom max_format_errors (limit is 2)
    @runner.mock_plans = [nil, nil, nil]
    res2 = @loop.run("test format error limit")
    assert_equal :failed, res2.status
    assert_equal 4, @runner.plan_stream_called

    # 3. Test custom max_tool_errors (limit is 2)
    @runner.mock_plans = [
      { tool: "bash_command", args: { "command" => "rm" } },
      { tool: "bash_command", args: { "command" => "rm" } }
    ]
    @runner.mock_tool_results = [
      { status: "blocked", advice: "fail" },
      { status: "blocked", advice: "fail" }
    ]
    res3 = @loop.run("test tool error limit")
    assert_equal :failed, res3.status
    assert_equal 2, res3.steps.size
  end

  # ---------------------------------------------------------------------------
  # finish_reason "length" → truncation abort
  # ---------------------------------------------------------------------------
  def test_finish_reason_cutoff_abort
    @runner.mock_plans = [
      { type: "text", content: "Incomplete text...", finish_reason: "length" }
    ]

    aborted_event = nil
    @bus.subscribe(:loop_aborted) { |p| aborted_event = p }

    res = @loop.run("generate large code")

    assert_equal :failed, res.status
    assert_equal "Loop terminated due to finish_reason: length", aborted_event[:reason]
    assert_equal "Loop terminated due to finish_reason: length", res.failure_reason
    assert_equal 0, res.steps.size
  end

  # ---------------------------------------------------------------------------
  # finish_reason "content_filter" → safety abort
  # ---------------------------------------------------------------------------
  def test_finish_reason_safety_abort
    @runner.mock_plans = [
      { type: "text", content: "Filtered content", finish_reason: "content_filter" }
    ]

    aborted_event = nil
    @bus.subscribe(:loop_aborted) { |p| aborted_event = p }

    res = @loop.run("trigger filter")

    assert_equal :failed, res.status
    assert_equal "Loop terminated due to finish_reason: content_filter", aborted_event[:reason]
  end

  # ---------------------------------------------------------------------------
  # finish_reason "error" → provider error abort
  # ---------------------------------------------------------------------------
  def test_finish_reason_provider_error_abort
    @runner.mock_plans = [
      { type: "text", content: "", finish_reason: "error" }
    ]

    aborted_event = nil
    @bus.subscribe(:loop_aborted) { |p| aborted_event = p }

    res = @loop.run("trigger provider error")

    assert_equal :failed, res.status
    assert_equal "Loop terminated due to finish_reason: error", aborted_event[:reason]
  end

  # ---------------------------------------------------------------------------
  # finish_reason "stop" with content in args["content"] (legacy shape)
  # ---------------------------------------------------------------------------
  def test_stop_with_args_content
    @runner.mock_plans = [
      { type: "tool_call", args: { "content" => "legacy content" }, finish_reason: "stop" }
    ]

    res = @loop.run("test legacy content extraction")

    assert_equal :completed, res.status
    assert_equal "legacy content", res.final_content
  end
end
