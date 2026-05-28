# frozen_string_literal: true

module Aura
  module Context
    class Memory
      attr_reader :state

      def initialize(state:)
        @state = state.to_s.strip
      end

      def to_markdown
        @state
      end

      def to_s
        to_markdown
      end

      def to_str
        to_markdown
      end
    end
  end
end
