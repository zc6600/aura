# frozen_string_literal: true

module Aura
  module Memory
    module Adapters
      class CompatibilityAdapter
        def initialize(memory)
          @memory = memory
          @store = memory.store
        end

        def record_event(payload)
          @store.insert_event(
            timestamp: payload[:timestamp] || Time.now.to_i,
            phase: payload[:phase],
            tool: payload[:tool],
            payload: payload
          )
        end

        def commit_summary(content, source_event_id = nil)
          @store.insert_summary(content: content, source_event_id: source_event_id)
        end

        def metabolize_if_needed
        end

        def get_active_variables
          @store.all_variables
        end

        def set_variable(key, value)
          @store.set_variable(key: key, value: value)
        end

        def get_latest_summary
          summaries = @store.fetch_summaries(limit: 1)
          summaries.last&.[]("content")
        end

        def get_recent_summaries(limit = nil)
          n = limit || 20
          entries = @store.fetch_summaries(limit: n)
          entries.map { |s| s["content"] }.join("\n")
        end

        def get_recent_summaries_structured(limit: nil)
          n = limit || 20
          @store.fetch_summaries(limit: n)
        end

        def get_recent_events
          n = 20
          rows = @store.fetch_events(limit: n)
          rows.map { |r| r["payload"].to_json }.join("\n")
        end

        def get_recent_events_structured(*args, **kwargs)
          if args.any? && args.first.is_a?(Hash)
            opts = args.first
            @store.fetch_events(
              limit: opts[:limit],
              phases: opts[:phases],
              tools: opts[:tools],
              since: opts[:since_ts]
            )
          else
            @store.fetch_events(
              limit: kwargs[:limit],
              phases: kwargs[:phases],
              tools: kwargs[:tools],
              since: kwargs[:since_ts]
            )
          end
        end

        def undo_last_turn
          @store.respond_to?(:undo_last_turn) ? @store.undo_last_turn : false
        end

        def redo_last_turn
          @store.respond_to?(:redo_last_turn) ? @store.redo_last_turn : false
        end

        def close
          @store.close
        end

        def read_config
          {}
        end

        private

        def fetch_recent_events_n
          20
        end
      end
    end
  end
end
