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
          db = @store.instance_variable_get(:@db)
          return false unless db

          last_user_id = db.get_first_value("SELECT id FROM events WHERE phase = 'user' ORDER BY id DESC LIMIT 1")
          return false unless last_user_id

          db.transaction do
            # Move events to undone_events
            db.execute("INSERT INTO undone_events SELECT * FROM events WHERE id >= ?", [last_user_id])
            db.execute("DELETE FROM events WHERE id >= ?", [last_user_id])
            
            # Move summaries to undone_summaries
            db.execute("INSERT INTO undone_summaries SELECT * FROM summaries WHERE source_event_id >= ?", [last_user_id])
            db.execute("DELETE FROM summaries WHERE source_event_id >= ?", [last_user_id])
          end
          true
        end

        def redo_last_turn
          db = @store.instance_variable_get(:@db)
          return false unless db

          # Find the earliest user event in undone_events
          next_user_id = db.get_first_value("SELECT MIN(id) FROM undone_events WHERE phase = 'user'")
          return false unless next_user_id

          # Find the next user event after that (if any) to define the range
          following_user_id = db.get_first_value("SELECT MIN(id) FROM undone_events WHERE phase = 'user' AND id > ?", [next_user_id])

          db.transaction do
            if following_user_id
              # Restore a single turn (range [next_user_id, following_user_id))
              db.execute("INSERT INTO events SELECT * FROM undone_events WHERE id >= ? AND id < ?", [next_user_id, following_user_id])
              db.execute("DELETE FROM undone_events WHERE id >= ? AND id < ?", [next_user_id, following_user_id])
              
              db.execute("INSERT INTO summaries SELECT * FROM undone_summaries WHERE source_event_id >= ? AND source_event_id < ?", [next_user_id, following_user_id])
              db.execute("DELETE FROM undone_summaries WHERE source_event_id >= ? AND source_event_id < ?", [next_user_id, following_user_id])
            else
              # Restore everything from next_user_id onwards (tail)
              db.execute("INSERT INTO events SELECT * FROM undone_events WHERE id >= ?", [next_user_id])
              db.execute("DELETE FROM undone_events WHERE id >= ?", [next_user_id])
              
              db.execute("INSERT INTO summaries SELECT * FROM undone_summaries WHERE source_event_id >= ?", [next_user_id])
              db.execute("DELETE FROM undone_summaries WHERE source_event_id >= ?", [next_user_id])
            end
          end
          true
        end

        def close
          @store.close
        end

        def send(method_name, *args, &block)
          if respond_to?(method_name, true)
            public_send(method_name, *args, &block)
          else
            super
          end
        end

        def respond_to_missing?(method_name, include_private = false)
          super
        end

        private

        def read_config
          {}
        end

        def fetch_recent_events_n
          20
        end
      end
    end
  end
end
