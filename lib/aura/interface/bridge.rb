# frozen_string_literal: true

require "aura/kernel/runner"
require "aura/kernel/agent_loop"

module Aura
  module Interface
    class Bridge
      attr_reader :runner

      def initialize(project_path, runner: nil)
        @runner = runner || Aura::Kernel::Runner.new(project_path)
        @callbacks = {}
      end

      # Register callbacks for UI events
      # Supported events: :on_token, :on_stream_end, :on_waiting, :on_clear_waiting, 
      #                   :on_tool_start, :on_tool_executing, :on_tool_result, :on_tool_blocked,
      #                   :on_warning, :on_error, :on_thought, :ask_confirmation
      def on(event, &block)
        @callbacks[event] = block
      end

      # Main entry point for processing a user turn
      def chat(input, auto_mode: false)
        @runner.record_user_input(input)

        # Start a new job for this turn
        @runner.start_job(input: input, auto_mode: auto_mode)

        setup_runner_subscriptions

        # Create EventBus for AgentLoop
        bus = Aura::Kernel::EventBus.new
        
        # Track streaming state for UI waiting indicator
        streamed = false
        start_time = nil

        bus.subscribe(:plan_stream_start) do
          streamed = false
          start_time = Time.now
          notify(:on_waiting, start_time, -> { streamed })
        end

        bus.subscribe(:plan_event) do |payload|
          if payload[:type] == "delta"
            unless streamed
              streamed = true
              notify(:on_clear_waiting)
            end
            notify(:on_token, payload[:text].to_s)
          end
        end

        bus.subscribe(:plan_stream_end) do
          notify(:on_stream_end)
        end

        bus.subscribe(:final_answer) do |payload|
          notify(:on_final_answer, payload[:content])
        end

        bus.subscribe(:tool_halted) do |payload|
          notify(:on_warning, "Tool '#{payload[:tool]}' halted (#{payload[:status]}): #{payload[:advice]}")
        end

        bus.subscribe(:thought) do |payload|
          elapsed = start_time ? (Time.now - start_time) : 0
          notify(:on_thought, payload[:content], elapsed)
        end

        bus.subscribe(:no_response) do
          notify(:on_warning, "No response. Check LLM configuration or API key.")
        end

        bus.subscribe(:loop_aborted) do |payload|
          if payload[:reason] == :format_errors
            notify(:on_warning, "Agent failed to produce a valid tool call after 5 attempts. Aborting.")
          elsif payload[:reason] == :tool_errors
            notify(:on_warning, "Too many tool errors (3). Aborting.")
          else
            notify(:on_warning, "Agent loop aborted: #{payload[:reason]}")
          end
        end

        # Instantiate and run AgentLoop
        agent_loop = Aura::Kernel::AgentLoop.new(@runner, event_bus: bus)
        
        begin
          res = agent_loop.run(input)
          if res.status == :completed
            @runner.end_job(:completed)
          else
            @runner.end_job(:failed, StandardError.new("Agent loop aborted: #{res.status}"))
          end
        rescue StandardError => e
          notify(:on_error, e.message)
          @runner.end_job(:failed, e)
          raise e
        end
      end

      # Expose hooks to allow external registration
      def hooks
        @runner.hooks
      end
      
      # Helper to register the standard dangerous tool confirmation hook
      def register_confirmation_hook(dangerous_tools)
        @runner.hooks.register(:before_tool_execution) do |tool, args|
          is_auto = @runner.current_job&.metadata&.dig(:auto_mode)
          next true if is_auto
          
          if dangerous_tools.include?(tool.to_s)
             if @callbacks[:ask_confirmation]
               @callbacks[:ask_confirmation].call("DANGEROUS TOOL: #{tool}. Execute?")
             else
               true
             end
          else
            true
          end
        end
      end

      private

      def notify(event, *args)
        @callbacks[event].call(*args) if @callbacks[event]
      end

      def setup_runner_subscriptions
        return if @subscribed
        
        @runner.on(:tool_start) do |payload|
          notify(:on_tool_start, payload[:tool], payload[:summary], payload[:args])
        end
        
        @runner.on(:tool_executing) do |_|
          notify(:on_tool_executing)
        end
        
        @runner.on(:tool_blocked) do |payload|
          notify(:on_warning, "Tool blocked: #{payload[:reason]}")
        end
        
        @runner.on(:tool_result) do |payload|
          notify(:on_tool_result, payload[:result])
        end
        
        @subscribed = true
      end
    end
  end
end
