# frozen_string_literal: true

require "aura/kernel/event_bus"

module Aura
  module Kernel
    # The unified agent loop controller.
    # Decoupled from UI rendering, orchestrates planner, execution, and observation.
    class AgentLoop
      Result = Struct.new(:status, :final_content, :steps, :failure_reason, keyword_init: true)

      def initialize(runner, event_bus: NullEventBus.new)
        @runner = runner
        @event_bus = event_bus
      end

      # Run the agent loop to achieve a goal.
      # @param goal [String]
      # @param ctx [String, nil] Starting context. If nil, runner.observe is used.
      # @param max_steps [Integer, nil] Maximum execution steps to prevent infinite loop. If nil, read from config.
      # @return [Result]
      def run(goal, ctx: nil, max_steps: nil)
        limit_steps   = max_steps || max_steps_from_config
        ctx           = ctx || observe
        format_errors = 0
        tool_errors   = 0
        steps         = []
        step_count    = 0

        loop do
          if step_count >= limit_steps
            @event_bus.emit(:loop_aborted, reason: "Max execution steps reached (#{limit_steps})")
            return Result.new(status: :failed, steps: steps, failure_reason: "Max execution steps reached (#{limit_steps})")
          end

          # Plan step
          plan = call_planner(goal, ctx)

          # Extract finish_reason from the LLM response (OpenRouter normalizes to:
          # "stop", "tool_calls", "length", "content_filter", "error")
          finish_reason = plan.is_a?(Hash) ? (plan[:finish_reason] || plan["finish_reason"]).to_s : ""

          # Normal completion: LLM stopped naturally with a final answer
          if finish_reason == "stop"
            content = extract_stop_content(plan)
            @event_bus.emit(:final_answer, content: content)
            return Result.new(status: :completed, final_content: content, steps: steps, failure_reason: nil)
          end

          # Abnormal termination: truncation, safety filter, or provider error
          if ["length", "content_filter", "error"].include?(finish_reason)
            reason = "Loop terminated due to finish_reason: #{finish_reason}"
            @event_bus.emit(:loop_aborted, reason: reason)
            return Result.new(status: :failed, steps: steps, failure_reason: reason)
          end

          # Validate that a tool call is present (expected when finish_reason == "tool_calls")
          unless plan.is_a?(Hash) && (plan[:tool] || plan["tool"])
            format_errors += 1
            thought = plan.is_a?(Hash) && (plan[:thought] || plan["thought"] || plan[:content] || plan["content"])
            if thought && !thought.to_s.empty?
              @event_bus.emit(:thought, content: thought.to_s)
            else
              @event_bus.emit(:no_response)
            end

            if format_errors >= max_format_errors
              @event_bus.emit(:loop_aborted, reason: :format_errors)
              return Result.new(status: :failed, steps: steps, failure_reason: "Max format errors reached (#{max_format_errors})")
            end
            ctx = inject_format_error(ctx)
            next
          end

          # Emit thought if present (mixed response: tool + reasoning)
          thought = plan[:thought] || plan["thought"]
          if thought && !thought.to_s.empty?
            @event_bus.emit(:thought, content: thought.to_s)
          end

          tool_name = (plan[:tool] || plan["tool"]).to_s
          format_errors = 0

          # Execute tool
          step_count += 1
          result = execute_tool(plan)
          steps << {
            tool: tool_name,
            args: (plan[:args] || plan["args"] || {}),
            summary: (plan[:summary] || plan["summary"]),
            result: result
          }

          case result[:status].to_s
          when "blocked", "upgrade_required", "failed"
            tool_errors += 1
            @event_bus.emit(:tool_halted, tool: tool_name, status: result[:status], advice: result[:advice])
            if tool_errors >= max_tool_errors
              @event_bus.emit(:loop_aborted, reason: :tool_errors)
              return Result.new(status: :failed, steps: steps, failure_reason: "Max tool errors reached (#{max_tool_errors})")
            end
            ctx = inject_tool_error(ctx, tool_name, result)
            next
          else
            # Reset tool errors on successful tool execution
            tool_errors = 0
          end

          # Update context with new observations
          ctx = observe
        end
      end

      def max_steps_from_config
        cfg = @runner.respond_to?(:load_config) ? @runner.load_config : {}
        cfg.dig("system", "max_steps") || 30
      end

      def max_format_errors
        cfg = @runner.respond_to?(:load_config) ? @runner.load_config : {}
        cfg.dig("system", "max_format_errors") || 5
      end

      def max_tool_errors
        cfg = @runner.respond_to?(:load_config) ? @runner.load_config : {}
        cfg.dig("system", "max_tool_errors") || 3
      end

      private

      def observe
        @runner.observe
      rescue Aura::Context::ContextOverflowError => e
        "[Context overflow] #{e.message}"
      end

      def call_planner(goal, ctx)
        @event_bus.emit(:plan_stream_start)
        @runner.plan_stream(goal, ctx) { |ev| @event_bus.emit(:plan_event, **ev) }
      ensure
        @event_bus.emit(:plan_stream_end)
      end

      def execute_tool(plan)
        call = {
          "tool"    => plan[:tool]    || plan["tool"],
          "args"    => plan[:args]    || plan["args"]    || {},
          "summary" => plan[:summary] || plan["summary"]
        }
        @runner.run_call(call)
      end

      # Extract content from a plan that arrived with finish_reason "stop".
      # Handles both plain-text responses and structured hashes.
      def extract_stop_content(plan)
        return "" unless plan.is_a?(Hash)
        # Prefer explicit content field, fall back to args["content"] for legacy compatibility
        (plan[:content] || plan["content"] ||
          (plan[:args] || plan["args"] || {})["content"]).to_s
      end

      def inject_format_error(ctx)
        <<~MSG.strip + "\n\n" + ctx.to_s
          [SYSTEM ERROR] Your last response did not contain a valid tool call.
          You MUST respond with a JSON object specifying a tool. Example:
            {"tool": "bash_command", "args": {"command": "ls"}, "summary": "List files"}
          To finish the task, simply provide your final answer as plain text — the system
          will detect the natural stop and complete automatically.
          Do NOT write any text outside the JSON object when calling a tool. Try again now.
        MSG
      end

      def inject_tool_error(ctx, tool_name, result)
        "[TOOL ERROR] Tool '#{tool_name}' was #{result[:status]}: #{result[:advice]}\n" \
        "Please choose a different approach or tool.\n\n#{observe}"
      end
    end
  end
end
