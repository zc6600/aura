# frozen_string_literal: true

module Aura
  module Context
    class Prompt
      attr_reader :kernel_prompt, :workspace_prompt

      def initialize(kernel_prompt, workspace_prompt)
        @kernel_prompt = kernel_prompt.to_s.strip
        @workspace_prompt = workspace_prompt.to_s.strip
      end

      def to_markdown
        [
          @kernel_prompt,
          @workspace_prompt
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
