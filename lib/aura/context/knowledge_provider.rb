# frozen_string_literal: true

require "json"

module Aura
  module Context
    class KnowledgeProvider
      def initialize(project_path)
        @project_path = project_path
        @knowledge_file = File.join(project_path, ".aura_knowledge.json")
      end

      def provide
        return "" unless File.exist?(@knowledge_file)

        begin
          knowledge = JSON.parse(File.read(@knowledge_file))
          return "" if knowledge.empty?

          section = ["# PROJECT KNOWLEDGE BASE (Persistent Facts)"]
          knowledge.each do |category, facts|
            next if facts.empty?

            section << "## #{category.capitalize}"
            facts.each { |fact| section << "- #{fact}" }
          end
          section.join("\n\n")
        rescue StandardError
          ""
        end
      end
    end
  end
end
