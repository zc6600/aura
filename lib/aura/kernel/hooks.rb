# frozen_string_literal: true

module Aura
  module Kernel
    class Hooks
      def initialize
        @hooks = {}
      end

      def register(name, &block)
        @hooks[name] ||= []
        @hooks[name] << block
      end

      def unregister(name, hook_proc)
        @hooks[name]&.delete(hook_proc)
      end

      # Runs hooks for a given name.
      # If any hook returns explicitly false (not nil), the operation may be considered halted/rejected.
      # Returns true if all hooks pass (or no hooks exist), false if any hook returns false.
      def run(name, *args)
        return true unless @hooks[name]

        @hooks[name].each do |hook|
          result = hook.call(*args)
          return false if result == false
        end
        true
      end
    end
  end
end
