# frozen_string_literal: true

require "thor/group"

module Aura
  module Generators
    class ToolsGenerator < Thor::Group
      include Thor::Actions

      argument :tool_name, type: :string

      def self.source_root
        File.expand_path("aura/app/templates/tools", __dir__)
      end

      def check_availability
        unless File.directory?(File.join(self.class.source_root, tool_name))
          raise Thor::Error, "Tool '#{tool_name}' not found in library. Available tools: #{available_tools.join(', ')}"
        end
      end

      def copy_tool
        directory tool_name, "tools/#{tool_name}"
        say "Tool '#{tool_name}' installed successfully!", :green
      end

      private

      def available_tools
        Dir.children(self.class.source_root).select { |f| File.directory?(File.join(self.class.source_root, f)) }
      rescue StandardError
        []
      end
    end
  end
end
