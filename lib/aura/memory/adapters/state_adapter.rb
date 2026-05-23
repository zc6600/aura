# frozen_string_literal: true

require_relative "../store"

module Aura
  module Memory
    module Adapters
      class StateAdapter < Store
        def initialize(state)
          @state = state
        end

        def insert_event(timestamp:, phase:, tool:, payload:)
          @state.record_event({
            phase: phase,
            tool: tool,
            timestamp: timestamp
          }.merge(payload))
        end

        def fetch_events(limit: nil, offset: nil, phases: nil, since: nil, tools: nil)
          if @state.respond_to?(:get_recent_events_structured, true)
            @state.send(:get_recent_events_structured, limit: limit, phases: phases, tools: tools, since_ts: since)
          else
            []
          end
        end

        def delete_events(event_ids)
          return if event_ids.empty?

          db = @state.instance_variable_get(:@db)
          placeholders = event_ids.map { "?" }.join(",")
          db.execute("DELETE FROM events WHERE id IN (#{placeholders})", event_ids)
        end

        def count_events
          db = @state.instance_variable_get(:@db)
          db.get_first_value("SELECT COUNT(*) FROM events").to_i
        end

        def total_events_chars
          db = @state.instance_variable_get(:@db)
          db.get_first_value("SELECT COALESCE(SUM(LENGTH(payload)), 0) FROM events").to_i
        end

        def insert_summary(content:, source_event_id: nil)
          @state.commit_summary(content, source_event_id)
        end

        def fetch_summaries(limit: nil)
          if @state.respond_to?(:get_recent_summaries_structured)
            @state.get_recent_summaries_structured(limit: limit)
          else
            []
          end
        end

        def set_variable(key:, value:)
          @state.set_variable(key, value)
        end

        def get_variable(key)
          vars = @state.get_active_variables
          vars[key.to_s]
        end

        def all_variables
          @state.get_active_variables
        end

        def transaction
          db = @state.instance_variable_get(:@db)
          db.transaction { yield }
        end
      end
    end
  end
end
