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

  def test_successful_flow
    # Step 1: run bash tool. Step 2: run final tool.
    @runner.mock_plans = [
      { tool: "bash_command", args: { "command" => "ls" }, summary: "List" },
      { tool: "final", args: { "content" => "Found files" }, summary: "Submit" }
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

  def test_plain_text_wrapping
    # Plan returns text content instead of a tool call
    @runner.mock_plans = [
      { type: "text", content: "Plain text answer" }
    ]

    res = @loop.run("ask question")

    assert_equal :completed, res.status
    assert_equal "Plain text answer", res.final_content
    assert_equal 0, res.steps.size
  end

  def test_format_error_tolerance
    # Plan 1 is malformed/nil. Plan 2 is final tool call.
    @runner.mock_plans = [
      nil,
      { tool: "final", args: { "content" => "recovered" } }
    ]

    res = @loop.run("recover format error")

    assert_equal :completed, res.status
    assert_equal "recovered", res.final_content
    assert_equal 2, @runner.plan_stream_called
  end

  def test_format_error_abort
    # Plan is consistently invalid
    @runner.mock_plans = [nil, nil, nil, nil, nil, nil]

    aborted_event = nil
    @bus.subscribe(:loop_aborted) { |p| aborted_event = p }

    res = @loop.run("fail format")

    assert_equal :failed, res.status
    assert_equal :format_errors, aborted_event[:reason]
    assert_equal 5, @runner.plan_stream_called
    assert_equal "Max format errors reached (5)", res.failure_reason
  end

  def test_tool_blocked_recovery
    # Step 1: blocked command. Step 2: final command.
    @runner.mock_plans = [
      { tool: "bash_command", args: { "command" => "rm -rf /" } },
      { tool: "final", args: { "content" => "safe answer" } }
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

  def test_tool_blocked_abort
    # Step 1, 2, 3: consistently blocked
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

  def test_raw_string_plan_wrapping
    # Plan returns a raw String instead of a hash
    @runner.mock_plans = [
      "Hello this is a direct response string"
    ]

    res = @loop.run("ask question")

    assert_equal :completed, res.status
    assert_equal "Hello this is a direct response string", res.final_content
    assert_equal 0, res.steps.size
  end

  def test_format_errors_reset_on_success
    # Plan 1: nil (format error)
    # Plan 2: bash tool call (success, resets format errors to 0)
    # Plan 3: nil (format error, format_errors becomes 1, not 2)
    # Plan 4: final tool call (success)
    @runner.mock_plans = [
      nil,
      { tool: "bash_command", args: { "command" => "ls" } },
      nil,
      { tool: "final", args: { "content" => "done" } }
    ]
    @runner.mock_tool_results = [
      { status: "success", content: "file.txt" }
    ]

    res = @loop.run("test reset")

    assert_equal :completed, res.status
    assert_equal "done", res.final_content
  end

  def test_custom_config_limits
    # Set custom config limits in runner
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
      { tool: "final", args: { "content" => "done" } }
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
end
