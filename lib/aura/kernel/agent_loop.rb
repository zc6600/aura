# frozen_string_literal: true

require "aura/kernel/event_bus"

module Aura
  module Kernel
    # The unified agent loop controller.
    # Decoupled from UI rendering, orchestrates planner, execution, and observation.
    class AgentLoop
      MAX_FORMAT_ERRORS = 5
      MAX_TOOL_ERRORS   = 3

      Result = Struct.new(:status, :final_content, :steps, keyword_init: true)

      def initialize(runner, event_bus: NullEventBus.new)
        @runner = runner
        @event_bus = event_bus
      end

      # Run the agent loop to achieve a goal.
      # @param goal [String]
      # @param ctx [String, nil] Starting context. If nil, runner.observe is used.
      # @param max_steps [Integer] Maximum execution steps to prevent infinite loop.
      # @return [Result]
      def run(goal, ctx: nil, max_steps: 30)
        ctx           = ctx || observe
        format_errors = 0
        tool_errors   = 0
        steps         = []
        step_count    = 0

        loop do
          if step_count >= max_steps
            @event_bus.emit(:loop_aborted, reason: "Max execution steps reached (#{max_steps})")
            return Result.new(status: :failed, steps: steps)
          end

          # Plan step
          plan = call_planner(goal, ctx)

          # If planning returns plain text, wrap it as final
          if plan.is_a?(String)
            plan = { type: "tool_call", tool: "final", args: { "content" => plan }, summary: "Text response" }
          elsif plan.nil? || (plan.is_a?(Hash) && plan[:type] == "text") || (plan.is_a?(Hash) && !plan[:tool] && !plan["tool"] && (plan[:content] || plan["content"]))
            plan = wrap_text_as_final(plan)
          end

          # Validate response structure
          unless plan.is_a?(Hash) && (plan[:tool] || plan["tool"])
            format_errors += 1
            thought = plan.is_a?(Hash) && (plan[:thought] || plan["thought"] || plan[:content] || plan["content"])
            if thought && !thought.to_s.empty?
              @event_bus.emit(:thought, content: thought.to_s)
            else
              @event_bus.emit(:no_response)
            end

            if format_errors >= MAX_FORMAT_ERRORS
              @event_bus.emit(:loop_aborted, reason: :format_errors)
              return Result.new(status: :failed, steps: steps)
            end
            ctx = inject_format_error(ctx)
            next
          end

          tool_name = (plan[:tool] || plan["tool"]).to_s
          format_errors = 0

          # Handle final answer
          if tool_name == "final"
            content = extract_final_content(plan)
            @event_bus.emit(:final_answer, content: content)
            return Result.new(status: :completed, final_content: content, steps: steps)
          end

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
          when "blocked", "upgrade_required"
            tool_errors += 1
            @event_bus.emit(:tool_halted, tool: tool_name, status: result[:status], advice: result[:advice])
            if tool_errors >= MAX_TOOL_ERRORS
              @event_bus.emit(:loop_aborted, reason: :tool_errors)
              return Result.new(status: :failed, steps: steps)
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

      def wrap_text_as_final(plan)
        return nil unless plan.is_a?(Hash)
        content = (plan[:content] || plan["content"]).to_s
        return nil if content.strip.empty?
        { type: "tool_call", tool: "final", args: { "content" => content }, summary: "Text response" }
      end

      def extract_final_content(plan)
        return "" unless plan.is_a?(Hash)
        (plan[:args] || plan["args"] || {})["content"].to_s
      end

      def inject_format_error(ctx)
        <<~MSG.strip + "\n\n" + ctx.to_s
          [SYSTEM ERROR] Your last response was plain text, not valid JSON.
          You MUST respond with a JSON object. Examples:
            {"tool": "bash_command", "args": {"command": "ls"}, "summary": "List files"}
            {"tool": "final", "args": {"content": "Done!"}, "summary": "Task complete"}
          Do NOT write any text outside the JSON object. Try again now.
        MSG
      end

      def inject_tool_error(ctx, tool_name, result)
        "[TOOL ERROR] Tool '#{tool_name}' was #{result[:status]}: #{result[:advice]}\n" \
        "Please choose a different approach or tool.\n\n#{observe}"
      end
    end
  end
end
