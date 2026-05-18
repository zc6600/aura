# frozen_string_literal: true

module Aura
  module Kernel
    module EventEmitter
      def on(event, &block)
        @listeners ||= {}
        @listeners[event] ||= []
        @listeners[event] << block
      end

      def emit(event, payload = {})
        return unless @listeners && @listeners[event]

        @listeners[event].each do |listener|
          listener.call(payload)
        end
      end
    end
  end
end
