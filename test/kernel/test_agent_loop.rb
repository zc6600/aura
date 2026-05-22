# frozen_string_literal: true

require "test_helper"
require "aura/kernel/agent_loop"
require "aura/kernel/event_bus"

# Define ContextOverflowError if not loaded
unless defined?(Aura::Context::ContextOverflowError)
  module Aura
    module Context
      class ContextOverflowError < StandardError; end
    end
  end
end

module Aura
  module Kernel
    # Mock Runner that simulates Planner, Executor, and Observer behavior
    # without requiring real LLM calls or filesystem operations.
    class MockRunner
      attr_accessor :plans, :tool_results, :observations, :config
      attr_reader :plan_calls, :tool_calls, :observe_calls

      def initialize
        @plans = []           # Sequence of plans to return
        @tool_results = []    # Sequence of tool execution results
        @observations = []    # Sequence of observations to return
        @config = {}          # Configuration hash
        @plan_calls = []      # Record of plan calls
        @tool_calls = []      # Record of tool calls
        @observe_calls = []   # Record of observe calls
        @plan_index = 0
        @tool_index = 0
        @obs_index = 0
      end

      def plan_stream(goal, ctx, &block)
        @plan_calls << { goal: goal, ctx: ctx }
        plan = @plans[@plan_index] || @plans.last
        @plan_index += 1
        # If block given, simulate streaming events
        block&.call({ type: "delta", text: "thinking..." })
        plan
      end

      def run_call(call)
        @tool_calls << call
        result = @tool_results[@tool_index] || @tool_results.last
        @tool_index += 1
        result || { status: "success", output: "ok" }
      end

      def observe
        @observe_calls << true
        obs = @observations[@obs_index] || @observations.last
        @obs_index += 1
        obs || "mock observation"
      end

      def load_config
        @config
      end
    end
  end
end

class TestAgentLoop < Minitest::Test
  def setup
    @runner = Aura::Kernel::MockRunner.new
    @events = []
    @event_bus = Aura::Kernel::EventBus.new
    # Subscribe to all events for verification
    @event_bus.subscribe(:*) { |event, payload| @events << [event, payload] }
    @loop = Aura::Kernel::AgentLoop.new(@runner, event_bus: @event_bus)
  end

  # Test 1: LLM immediately returns final answer (finish_reason = "stop")
  def test_completes_when_llm_returns_stop
    @runner.plans = [{
      finish_reason: "stop",
      content: "Task completed successfully!"
    }]

    result = @loop.run("do something")

    assert_equal :completed, result.status
    assert_equal "Task completed successfully!", result.final_content
    assert_empty result.steps, "Should not execute any tools"
    assert_nil result.failure_reason

    # Verify events
    event_types = @events.map(&:first)
    assert_includes event_types, :plan_stream_start
    assert_includes event_types, :plan_stream_end
    assert_includes event_types, :final_answer
  end

  # Test 2: Execute one tool then complete
  def test_executes_single_tool_then_completes
    @runner.plans = [
      { tool: "bash", args: { command: "ls" }, summary: "List files", finish_reason: "tool_calls" },
      { finish_reason: "stop", content: "Found file1.rb and file2.rb" }
    ]
    @runner.tool_results = [
      { status: "success", output: "file1.rb\nfile2.rb" }
    ]

    result = @loop.run("list files")

    assert_equal :completed, result.status
    assert_equal "Found file1.rb and file2.rb", result.final_content
    assert_equal 1, result.steps.length
    assert_equal "bash", result.steps[0][:tool]
    assert_equal({ command: "ls" }, result.steps[0][:args])
    assert_equal "List files", result.steps[0][:summary]
  end

  # Test 3: Abort when max steps reached
  def test_aborts_on_max_steps
    @runner.config = { "system" => { "max_steps" => 3 } }
    # LLM keeps wanting to call tools (infinite loop scenario)
    @runner.plans = [
      { tool: "bash", args: {}, finish_reason: "tool_calls" }
    ] * 10
    @runner.tool_results = [
      { status: "success", output: "ok" }
    ] * 10

    result = @loop.run("infinite task")

    assert_equal :failed, result.status
    assert_match /Max execution steps reached \(3\)/, result.failure_reason
    assert_equal 3, result.steps.length, "Should stop after exactly 3 steps"

    # Verify abort event
    abort_events = @events.select { |e, _| e == :loop_aborted }
    assert_equal 1, abort_events.length
    assert_match /Max execution steps/, abort_events[0][1][:reason]
  end

  # Test 4: Abort on excessive format errors (no tool in response)
  def test_aborts_on_format_errors
    @runner.config = { "system" => { "max_format_errors" => 2 } }
    # LLM returns responses without tool field (finish_reason must be "tool_calls" to continue loop)
    @runner.plans = [
      { thought: "thinking...", finish_reason: "tool_calls" },  # Missing tool
      { thought: "still thinking", finish_reason: "tool_calls" } # Missing tool
    ]

    result = @loop.run("do task")

    assert_equal :failed, result.status
    assert_match /Max format errors reached \(2\)/, result.failure_reason

    # Verify thought events
    thought_events = @events.select { |e, _| e == :thought }
    assert_equal 2, thought_events.length
  end

  # Test 5: Abort on excessive tool errors
  def test_aborts_on_tool_errors
    @runner.config = { "system" => { "max_tool_errors" => 2 } }
    @runner.plans = [
      { tool: "bash", args: {}, finish_reason: "tool_calls" }
    ] * 5
    @runner.tool_results = [
      { status: "failed", advice: "permission denied" }
    ] * 5

    result = @loop.run("risky task")

    assert_equal :failed, result.status
    assert_match /Max tool errors reached \(2\)/, result.failure_reason
    assert_equal 2, result.steps.length, "Should stop after 2 tool failures"

    # Verify tool_halted events
    halted_events = @events.select { |e, _| e == :tool_halted }
    assert_equal 2, halted_events.length
    assert_equal "bash", halted_events[0][1][:tool]
    assert_equal "failed", halted_events[0][1][:status]
  end

  # Test 6: Abort on abnormal LLM finish (length, content_filter, error)
  def test_aborts_on_length_finish
    @runner.plans = [{
      finish_reason: "length",
      content: "truncated response..."
    }]

    result = @loop.run("long task")

    assert_equal :failed, result.status
    assert_match /finish_reason: length/, result.failure_reason
  end

  def test_aborts_on_content_filter_finish
    @runner.plans = [{
      finish_reason: "content_filter",
      content: "filtered content"
    }]

    result = @loop.run("sensitive task")

    assert_equal :failed, result.status
    assert_match /finish_reason: content_filter/, result.failure_reason
  end

  def test_aborts_on_error_finish
    @runner.plans = [{
      finish_reason: "error",
      content: "LLM error occurred"
    }]

    result = @loop.run("task with error")

    assert_equal :failed, result.status
    assert_match /finish_reason: error/, result.failure_reason
  end

  # Test 7: Emit thought events when present
  def test_emits_thought_events
    @runner.plans = [
      {
        tool: "read_file",
        args: { path: "test.rb" },
        thought: "I should read the file first to understand its structure",
        finish_reason: "tool_calls"
      },
      { finish_reason: "stop", content: "Done" }
    ]
    @runner.tool_results = [{ status: "success", output: "content" }]

    @loop.run("analyze file")

    thought_events = @events.select { |e, _| e == :thought }
    assert_equal 1, thought_events.length
    assert_match /read the file first/, thought_events[0][1][:content]
  end

  # Test 8: Recover from single tool error (below threshold)
  def test_recovers_from_single_tool_error
    @runner.plans = [
      { tool: "bash", args: { command: "rm" }, finish_reason: "tool_calls" },
      { tool: "read_file", args: { path: "test.rb" }, finish_reason: "tool_calls" },
      { finish_reason: "stop", content: "Success after retry" }
    ]
    @runner.tool_results = [
      { status: "failed", advice: "operation not permitted" },
      { status: "success", output: "file content" }
    ]

    result = @loop.run("recover test")

    assert_equal :completed, result.status
    assert_equal "Success after retry", result.final_content
    assert_equal 2, result.steps.length, "Both tools should execute"
    assert_equal "bash", result.steps[0][:tool]
    assert_equal "read_file", result.steps[1][:tool]
  end

  # Test 9: Tool error resets on successful execution
  def test_tool_error_counter_resets_on_success
    @runner.config = { "system" => { "max_tool_errors" => 2 } }
    @runner.plans = [
      { tool: "bash", args: {}, finish_reason: "tool_calls" },
      { tool: "read_file", args: {}, finish_reason: "tool_calls" },
      { tool: "bash", args: {}, finish_reason: "tool_calls" },
      { tool: "bash", args: {}, finish_reason: "tool_calls" },
      { finish_reason: "stop", content: "completed" }
    ]
    @runner.tool_results = [
      { status: "failed", advice: "error 1" },
      { status: "success", output: "ok" },  # This should reset counter
      { status: "failed", advice: "error 2" },
      { status: "success", output: "ok" }   # Counter reset again
    ]

    result = @loop.run("test reset")

    assert_equal :completed, result.status, "Should complete because counter resets"
    assert_equal 4, result.steps.length
  end

  # Test 10: Format error counter resets on valid tool call
  def test_format_error_counter_resets
    @runner.config = { "system" => { "max_format_errors" => 3 } }
    @runner.plans = [
      { thought: "no tool here", finish_reason: "tool_calls" },  # Format error 1
      { thought: "still no tool", finish_reason: "tool_calls" }, # Format error 2
      { tool: "bash", args: {}, finish_reason: "tool_calls" },   # Valid! Reset counter
      { finish_reason: "stop", content: "done" }
    ]
    @runner.tool_results = [{ status: "success" }]

    result = @loop.run("test format reset")

    assert_equal :completed, result.status, "Should complete because counter reset"
  end

  # Test 11: Use default max_steps from config when not provided
  def test_uses_default_max_steps
    @runner.config = {}  # No max_steps configured
    # Default should be 30 (from agent_loop.rb line 116)
    @runner.plans = [
      { tool: "bash", args: {}, finish_reason: "tool_calls" }
    ] * 35
    @runner.tool_results = [
      { status: "success" }
    ] * 35

    result = @loop.run("long running")

    assert_equal :failed, result.status
    assert_equal 30, result.steps.length, "Should use default max_steps=30"
  end

  # Test 12: Custom max_steps parameter overrides config
  def test_custom_max_steps_parameter
    @runner.config = { "system" => { "max_steps" => 100 } }
    @runner.plans = [
      { tool: "bash", args: {}, finish_reason: "tool_calls" }
    ] * 10
    @runner.tool_results = [
      { status: "success" }
    ] * 10

    result = @loop.run("task", max_steps: 5)

    assert_equal :failed, result.status
    assert_equal 5, result.steps.length, "Parameter should override config"
  end

  # Test 13: Record all tool calls with arguments
  def test_records_tool_calls_with_args
    @runner.plans = [
      { tool: "bash", args: { command: "ls -la" }, finish_reason: "tool_calls" },
      { tool: "read_file", args: { path: "test.rb" }, finish_reason: "tool_calls" },
      { finish_reason: "stop", content: "done" }
    ]
    @runner.tool_results = [
      { status: "success" },
      { status: "success" }
    ]

    @loop.run("test recording")

    assert_equal 2, @runner.tool_calls.length
    assert_equal "bash", @runner.tool_calls[0]["tool"]
    assert_equal({ command: "ls -la" }, @runner.tool_calls[0]["args"])
    assert_equal "read_file", @runner.tool_calls[1]["tool"]
    assert_equal({ path: "test.rb" }, @runner.tool_calls[1]["args"])
  end

  # Test 14: Handle both symbol and string keys in plan
  def test_handles_symbol_and_string_keys
    @runner.plans = [
      { "tool" => "bash", "args" => { "command" => "pwd" }, "finish_reason" => "tool_calls" },
      { "finish_reason" => "stop", "content" => "current directory" }
    ]
    @runner.tool_results = [{ status: "success", output: "/home/user" }]

    result = @loop.run("check directory")

    assert_equal :completed, result.status
    assert_equal 1, result.steps.length
    assert_equal "bash", result.steps[0][:tool]
  end

  # Test 15: Observe called after successful tool execution
  def test_observe_after_tool_execution
    @runner.plans = [
      { tool: "bash", args: {}, finish_reason: "tool_calls" },
      { finish_reason: "stop", content: "done" }
    ]
    @runner.tool_results = [{ status: "success" }]

    @loop.run("test observe")

    assert @runner.observe_calls.length >= 2, "Should observe at start and after tool"
  end

  # Test 16: Context overflow error handling
  def test_handles_context_overflow_error
    # Make observe raise ContextOverflowError
    def @runner.observe
      raise Aura::Context::ContextOverflowError, "Context too large"
    end

    @runner.plans = [
      { finish_reason: "stop", content: "handled overflow" }
    ]

    # Should not raise, should handle gracefully
    result = @loop.run("test overflow")

    assert_equal :completed, result.status
  end

  # Test 17: Multiple tools in sequence
  def test_multiple_tools_sequence
    @runner.plans = [
      { tool: "bash", args: { command: "mkdir test" }, finish_reason: "tool_calls" },
      { tool: "bash", args: { command: "cd test" }, finish_reason: "tool_calls" },
      { tool: "bash", args: { command: "touch file.txt" }, finish_reason: "tool_calls" },
      { finish_reason: "stop", content: "Created directory and file" }
    ]
    @runner.tool_results = [
      { status: "success" },
      { status: "success" },
      { status: "success" }
    ]

    result = @loop.run("setup project")

    assert_equal :completed, result.status
    assert_equal 3, result.steps.length
    assert_equal "mkdir test", result.steps[0][:args][:command]
    assert_equal "cd test", result.steps[1][:args][:command]
    assert_equal "touch file.txt", result.steps[2][:args][:command]
  end

  # Test 18: Blocked tool status
  def test_handles_blocked_tool_status
    @runner.plans = [
      { tool: "bash", args: {}, finish_reason: "tool_calls" },
      { finish_reason: "stop", content: "alternative approach" }
    ]
    @runner.tool_results = [
      { status: "blocked", advice: "This tool is not allowed" }
    ]

    result = @loop.run("blocked tool test")

    assert_equal :completed, result.status
    halted_events = @events.select { |e, _| e == :tool_halted }
    assert_equal 1, halted_events.length
    assert_equal "blocked", halted_events[0][1][:status]
  end

  # Test 19: Upgrade required tool status
  def test_handles_upgrade_required_status
    @runner.plans = [
      { tool: "bash", args: {}, finish_reason: "tool_calls" },
      { finish_reason: "stop", content: "done" }
    ]
    @runner.tool_results = [
      { status: "upgrade_required", advice: "Premium feature" }
    ]

    result = @loop.run("premium test")

    assert_equal :completed, result.status
    halted_events = @events.select { |e, _| e == :tool_halted }
    assert_equal 1, halted_events.length
    assert_equal "upgrade_required", halted_events[0][1][:status]
  end

  # Test 20: Empty steps when LLM stops immediately
  def test_empty_steps_on_immediate_stop
    @runner.plans = [{
      finish_reason: "stop",
      content: "No tools needed"
    }]

    result = @loop.run("simple question")

    assert_equal :completed, result.status
    assert_empty result.steps
    assert_equal "No tools needed", result.final_content
  end
end
