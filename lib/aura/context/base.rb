# frozen_string_literal: true

module Aura
  module Context
    class Base
      def initialize(project_path, db)
        @project_path = project_path
        @db = db
        @providers = [
          DirectiveProvider.new,
          EnvironmentProvider.new(project_path),
          ToolProvider.new(project_path),
          StateProvider.new(db)
        ]
      end

      def assemble
        content = @providers.map { |p| p.provide }.compact.join("\n\n")
        limit = fetch_max_chars(@project_path)
        if limit && content.length > limit
          raise ContextOverflowError, "Context length #{content.length} exceeds limit #{limit}"
        end
        content
      end

      private
        def fetch_max_chars(path)
          cfg = File.join(path, "config", "config.yml")
          return nil unless File.exist?(cfg)
          begin
            require "yaml"
            data = YAML.load_file(cfg)
            data.dig("state_management", "max_state_chars")
          rescue StandardError
            nil
          end
        end
    end
  end
end
