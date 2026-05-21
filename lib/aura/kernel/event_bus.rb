# frozen_string_literal: true

module Aura
  module Kernel
    # A generic publisher-subscriber event bus.
    class EventBus
      def initialize
        @listeners = Hash.new { |h, k| h[k] = [] }
      end

      def subscribe(event_type, &block)
        @listeners[event_type] << block
        self
      end

      def emit(event_type, **payload)
        @listeners[event_type].each do |listener|
          begin
            listener.call(payload)
          rescue => e
            $stderr.puts "[EventBus Error] Exception in listener for #{event_type}: #{e.message}"
          end
        end
        # Also support wildcard listeners
        @listeners[:*].each do |listener|
          begin
            listener.call(event_type, payload)
          rescue => e
            $stderr.puts "[EventBus Error] Exception in wildcard listener for #{event_type}: #{e.message}"
          end
        end
      end
    end

    # Adapts traditional Bridge block callback hashes to the EventBus architecture.
    class CallbackEventBus
      def initialize(callbacks = {})
        @callbacks = callbacks || {}
      end

      def emit(event, **payload)
        case event
        when :plan_event
          handle_plan_event(payload)
        when :final_answer
          @callbacks[:on_final_answer]&.call(payload[:content])
        when :tool_halted
          @callbacks[:on_warning]&.call("Tool '#{payload[:tool]}' halted (#{payload[:status]}): #{payload[:advice]}")
        when :loop_aborted
          @callbacks[:on_warning]&.call("Agent loop aborted: #{payload[:reason]}")
        end
      end

      private

      def handle_plan_event(payload)
        case payload[:type]
        when "delta"
          @callbacks[:on_token]&.call(payload[:text].to_s)
        end
      end
    end

    class NullEventBus
      def emit(event, **); end
    end
  end
end
