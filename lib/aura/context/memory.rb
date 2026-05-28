# frozen_string_literal: true

module Aura
  module Context
    class Memory
      attr_reader :state, :task, :env, :lsp, :knowledge

      def initialize(state:, task:, env:, lsp:, knowledge:)
        @state = state.to_s.strip
        @task = task.to_s.strip
        @env = env.to_s.strip
        @lsp = lsp.to_s.strip
        @knowledge = knowledge.to_s.strip
      end

      def to_markdown
        [
          @task,
          @state,
          @env,
          @lsp,
          @knowledge
        ].reject(&:empty?).join("\n\n")
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
