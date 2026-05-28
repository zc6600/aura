# frozen_string_literal: true

module Aura
  module Context
    class EnvProvider
      attr_reader :overview, :lsp, :knowledge

      def initialize(overview:, lsp:, knowledge:)
        @overview = overview.to_s.strip
        @lsp = lsp.to_s.strip
        @knowledge = knowledge.to_s.strip
      end

      # Serializes all environment blocks sequentially
      def to_markdown
        [
          @overview,
          @lsp,
          @knowledge
        ].reject(&:empty?).join("\n\n")
      end

      alias to_s to_markdown
      alias to_str to_markdown
    end
  end
end
