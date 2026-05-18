# frozen_string_literal: true

require "json"
require "fileutils"

module Aura
  module Kernel
    module Tools
      class RememberFact
        def initialize(project_path)
          @project_path = project_path
          @knowledge_file = File.join(project_path, ".aura_knowledge.json")
        end

        def execute(args)
          fact = args["fact"]
          category = args["category"] || "general"

          unless fact
            return { content: "Error: No fact provided.", is_error: true }
          end

          knowledge = load_knowledge
          knowledge[category] ||= []
          
          # Avoid duplicates
          unless knowledge[category].include?(fact)
            knowledge[category] << fact
          end

          save_knowledge(knowledge)
          { content: "Fact remembered in category '#{category}': #{fact}", is_error: false }
        end

        private

        def load_knowledge
          return {} unless File.exist?(@knowledge_file)
          begin
            JSON.parse(File.read(@knowledge_file))
          rescue StandardError
            {}
          end
        end

        def save_knowledge(knowledge)
          File.write(@knowledge_file, JSON.pretty_generate(knowledge))
        end
      end
    end
  end
end
