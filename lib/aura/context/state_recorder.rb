# frozen_string_literal: true

require "json"

module Aura
  module Context
    # StateRecorder: Writes events to the state database
    # 
    # This is the write-side counterpart to StateProvider (read-side).
    # It provides a structured interface for persisting events from different phases:
    # - user: User input messages
    # - plan: LLM's planning/decision (tool calls with thought/summary)
    # - execution: Tool execution results
    # - interception: Tool validation/interception events
    # - learn: Learning/reflection events
    #
    # Usage:
    #   recorder = StateRecorder.new(state)
    #   recorder.record_user("Hello")
    #   recorder.record_plan({ tool: "read_file", args: {...}, thought: "...", summary: "..." })
    #   recorder.record_execution("read_file", { status: "ok", output: "..." }, call_seq: 1)
    class StateRecorder
      def initialize(state)
        @state = state
      end

      # Record a user input event
      # @param content [String] The user's message
      # @param call_seq [Integer, nil] Sequence ID for ordering
      # @return [Integer] Event ID
      def record_user(content, call_seq: nil)
        payload = { phase: "user", content: content.to_s }
        payload[:call_seq] = call_seq if call_seq
        @state.record_event(payload)
      end

      # Record a plan/decision event from the LLM
      # @param plan [Hash] The parsed plan from LLM (tool, args, thought, summary, etc.)
      # @return [Integer] Event ID
      def record_plan(plan)
        return nil unless plan.is_a?(Hash)
        
        # Extract and normalize plan components
        plan_data = {
          phase: "plan",
          tool: plan[:tool] || plan["tool"],
          args: plan[:args] || plan["args"] || {},
          summary: plan[:summary] || plan["summary"],
          thought: plan[:thought] || plan["thought"]
        }
        
        # Preserve any additional fields from the original plan
        plan.each do |key, value|
          key_str = key.to_s
          next if %w[tool args summary thought type].include?(key_str)
          plan_data[key_str] = value
        end
        
        @state.record_event(plan_data)
      end

      # Record a tool execution event
      # @param tool_name [String] The tool that was executed
      # @param result [Hash] The execution result (status, output, content, etc.)
      # @param call_seq [Integer, nil] Sequence ID linking to the user input
      # @return [Integer] Event ID
      def record_execution(tool_name, result, call_seq: nil)
        payload = {
          phase: "execution",
          tool: tool_name.to_s,
          result: result.is_a?(Hash) ? result : { output: result.to_s },
          call_seq: call_seq
        }
        @state.record_event(payload)
      end

      # Record a tool interception event (validation failure, hook rejection, etc.)
      # @param tool_name [String] The tool that was intercepted
      # @param advice [String] Explanation of why it was intercepted
      # @param reason [String, nil] Additional reason context
      # @return [Integer] Event ID
      def record_interception(tool_name, advice, reason: nil)
        payload = {
          phase: "interception",
          tool: tool_name.to_s,
          advice: advice.to_s
        }
        payload[:reason] = reason if reason
        @state.record_event(payload)
      end

      # Record a learning/reflection event
      # @deprecated Currently not used - empty learn events provide no value
      # @param content [String, nil] Optional learning content
      # @return [Integer] Event ID
      def record_learn(content = nil)
        payload = { phase: "learn" }
        payload[:content] = content if content
        @state.record_event(payload)
      end

      # Record a custom event with arbitrary phase and payload
      # @param phase [String] The event phase
      # @param payload [Hash] Additional event data
      # @return [Integer] Event ID
      def record_custom(phase, payload = {})
        @state.record_event({ phase: phase.to_s }.merge(payload))
      end

      # Batch record multiple events in order (atomic within state's locking)
      # @param events [Array<Hash>] Array of event records with :type and other fields
      # @return [Array<Integer>] Array of event IDs
      def record_batch(events)
        event_ids = []
        events.each do |event|
          type = event[:type] || event["type"]
          case type
          when "user"
            event_ids << record_user(event[:content] || event["content"], call_seq: event[:call_seq])
          when "plan"
            event_ids << record_plan(event[:plan] || event["plan_data"])
          when "execution"
            event_ids << record_execution(
              event[:tool] || event["tool_name"],
              event[:result],
              call_seq: event[:call_seq]
            )
          when "interception"
            event_ids << record_interception(
              event[:tool] || event["tool_name"],
              event[:advice],
              reason: event[:reason]
            )
          when "learn"
            event_ids << record_learn(event[:content])
          else
            event_ids << record_custom(type, event.reject { |k, _| [:type].include?(k) })
          end
        end
        event_ids
      end
    end
  end
end
