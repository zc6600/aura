# frozen_string_literal: true

require "json"

module Aura
  module Context
    class StateProvider
      def initialize(db)
        @db = db
      end

      def provide
        return nil unless @db
        section = ["# AGENT STATE & MEMORY"]
        if @db.respond_to?(:get_latest_summary)
          summary = @db.get_latest_summary
          section << "### Historical Summary:\n#{summary}" if summary
        end
        if @db.respond_to?(:get_active_variables)
          vars = @db.get_active_variables || {}
          section << "### Active Variables:\n#{vars.to_json}" unless vars.empty?
        end
        if @db.respond_to?(:get_recent_events)
          recent = @db.get_recent_events
          section << "### Recent Activity Trace:\n#{recent}" if recent
        end
        section.join("\n")
      end
    end
  end
end

