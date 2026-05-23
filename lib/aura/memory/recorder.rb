# frozen_string_literal: true

module Aura
  module Memory
    class Recorder
      def initialize(store)
        @store = store
      end

      def record_user(content, call_seq: nil)
        payload = { content: content.to_s, call_seq: call_seq }
        @store.insert_event(
          timestamp: Time.now.to_i,
          phase: "user",
          tool: nil,
          payload: payload.merge(phase: "user")
        )
      end

      def record_plan(plan)
        return nil unless plan.is_a?(Hash)

        plan_data = {
          tool: plan[:tool] || plan["tool"],
          args: plan[:args] || plan["args"] || {},
          summary: plan[:summary] || plan["summary"],
          thought: plan[:thought] || plan["thought"]
        }

        plan.each do |key, value|
          key_str = key.to_s
          next if %w[tool args summary thought type].include?(key_str)

          plan_data[key_str] = value
        end

        @store.insert_event(
          timestamp: Time.now.to_i,
          phase: "plan",
          tool: plan_data[:tool],
          payload: plan_data.merge(phase: "plan", tool: plan_data[:tool])
        )
      end

      def record_execution(tool_name, result, call_seq: nil)
        result_payload = result.is_a?(Hash) ? result : { output: result.to_s }
        payload = { result: result_payload, call_seq: call_seq }
        @store.insert_event(
          timestamp: Time.now.to_i,
          phase: "execution",
          tool: tool_name.to_s,
          payload: payload.merge(phase: "execution", tool: tool_name.to_s)
        )
      end

      def record_interception(tool_name, advice, reason: nil)
        payload = { advice: advice.to_s }
        payload[:reason] = reason if reason

        @store.insert_event(
          timestamp: Time.now.to_i,
          phase: "interception",
          tool: tool_name.to_s,
          payload: payload.merge(phase: "interception", tool: tool_name.to_s)
        )
      end

      def record_custom(phase, payload = {})
        tool = payload[:tool] || payload["tool"]
        @store.insert_event(
          timestamp: Time.now.to_i,
          phase: phase.to_s,
          tool: tool,
          payload: payload.merge(phase: phase.to_s, tool: tool)
        )
      end

      def record_summary(content, source_event_id = nil)
        @store.insert_summary(
          content: content,
          source_event_id: source_event_id
        )
      end

      def record_batch(events)
        @store.transaction do
          events.map do |event|
            type = event[:type] || event["type"]
            case type
            when "user"
              record_user(event[:content] || event["content"], call_seq: event[:call_seq])
            when "plan"
              record_plan(event[:plan] || event["plan_data"])
            when "execution"
              record_execution(
                event[:tool] || event["tool_name"],
                event[:result],
                call_seq: event[:call_seq]
              )
            when "interception"
              record_interception(
                event[:tool] || event["tool_name"],
                event[:advice],
                reason: event[:reason]
              )
            else
              record_custom(type, event.reject { |k, _| [:type].include?(k) })
            end
          end
        end
      end
    end
  end
end
