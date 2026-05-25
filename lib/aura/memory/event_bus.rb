# frozen_string_literal: true

#
# Memory::EventBus - Simple event bus interface for Memory module
#
# This provides a minimal event bus interface that:
# 1. Doesn't depend on Runner or Kernel specifics
# 2. Can be easily mocked for testing
# 3. Allows any object that responds to #emit to be used
#

module Aura
  module Memory
    class EventBus
      def initialize(emitter = nil)
        @emitter = emitter
        @listeners = Hash.new { |h, k| h[k] = [] }
      end

      def emit(event, data = {})
        @emitter.emit(event, data) if @emitter.respond_to?(:emit)

        @listeners[event.to_sym].each do |listener|
          listener.call(data)
        end
      end

      def on(event, &block)
        @listeners[event.to_sym] << block
      end

      def off(event, &block)
        if block
          @listeners[event.to_sym].delete(block)
        else
          @listeners.delete(event.to_sym)
        end
      end
    end

    module EventEmitter
      def emit(event, data = {}); end
    end
  end
end
