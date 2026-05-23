# frozen_string_literal: true

begin
  require_relative "../../kernel/narrative_service"
rescue LoadError
end

module Aura
  module Memory
    class Summarizer
      def initialize(project_path = ".")
        @project_path = project_path
      end

      def synthesize(events)
        if defined?(Aura::Kernel::NarrativeService)
          narrative_service = Aura::Kernel::NarrativeService.new(@project_path)
          narrative_service.synthesize(events)
        else
          "Summary of #{events.size} events"
        end
      end
    end
  end
end
