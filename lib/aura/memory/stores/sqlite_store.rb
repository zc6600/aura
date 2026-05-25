# frozen_string_literal: true

require "sqlite3"
require "fileutils"
require "monitor"
require "aura/path_resolver"
require_relative "../store"

module Aura
  module Memory
    module Stores
      class SQLiteStore < Store
        def initialize(config = {})
          @db_path = if config[:db_path]
                       File.expand_path(config[:db_path])
                     elsif config[:project_path]
                       Aura::PathResolver.session_db_path(config[:project_path])
                     else
                       raise ArgumentError, "Either :db_path or :project_path must be provided"
                     end
          @db_lock = Monitor.new
          init_db
        end

        def insert_event(timestamp:, phase:, tool:, payload:)
          @db_lock.synchronize do
            if phase.to_s == "user"
              @db.execute("DELETE FROM undone_events")
              @db.execute("DELETE FROM undone_summaries")
            end
            @db.execute(
              "INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)",
              [timestamp, phase, tool, serialize_payload(payload)]
            )
            @db.last_insert_row_id
          end
        end

        def fetch_events(limit: nil, offset: nil, phases: nil, since: nil, tools: nil)
          query = +"SELECT id, timestamp, phase, tool, payload FROM events"
          conditions = []
          args = []

          if phases && !phases.empty?
            placeholders = phases.map { "?" }.join(",")
            conditions << "phase IN (#{placeholders})"
            args.concat(phases)
          end

          if tools && !tools.empty?
            placeholders = tools.map { "?" }.join(",")
            conditions << "tool IN (#{placeholders})"
            args.concat(tools)
          end

          if since
            conditions << "timestamp >= ?"
            args << since.to_i
          end

          query << " WHERE #{conditions.join(' AND ')}" unless conditions.empty?
          query << " ORDER BY id DESC"
          if offset
            query << " LIMIT ? OFFSET ?"
            args << (limit || -1)
            args << offset
          elsif limit
            query << " LIMIT ?"
            args << limit
          end

          rows = @db.execute(query, args)
          events = rows.map do |id, ts, phase, tool, payload|
            {
              "id" => id,
              "timestamp" => ts,
              "phase" => phase,
              "tool" => tool,
              "payload" => deserialize_payload(payload)
            }
          end
          events.sort_by! { |e| e["id"] }
        end

        def delete_events(event_ids)
          return if event_ids.empty?

          @db_lock.synchronize do
            placeholders = event_ids.map { "?" }.join(",")
            @db.execute("DELETE FROM events WHERE id IN (#{placeholders})", event_ids)
          end
        end

        def count_events
          @db.get_first_value("SELECT COUNT(*) FROM events").to_i
        end

        def total_events_chars
          @db.get_first_value("SELECT COALESCE(SUM(LENGTH(payload)), 0) FROM events").to_i
        end

        def insert_summary(content:, source_event_id: nil)
          @db_lock.synchronize do
            @db.execute(
              "INSERT INTO summaries (timestamp, content, source_event_id) VALUES (?, ?, ?)",
              [Time.now.to_i, content, source_event_id]
            )
            @db.last_insert_row_id
          end
        end

        def fetch_summaries(limit: nil)
          query = +"SELECT id, timestamp, content, source_event_id FROM summaries ORDER BY id DESC"
          query << " LIMIT ?" if limit
          args = limit ? [limit] : []

          rows = @db.execute(query, args)
          summaries = rows.map do |id, ts, content, source_event_id|
            {
              "id" => id,
              "timestamp" => ts,
              "content" => content,
              "source_event_id" => source_event_id
            }
          end
          summaries.sort_by! { |s| s["id"] }
        end

        def set_variable(key:, value:)
          @db_lock.synchronize do
            @db.execute(
              "INSERT OR REPLACE INTO variables (key, value) VALUES (?, ?)",
              [key.to_s, value.to_s]
            )
          end
        end

        def get_variable(key)
          @db.get_first_value("SELECT value FROM variables WHERE key = ?", [key.to_s])
        end

        def all_variables
          vars = {}
          @db.execute("SELECT key, value FROM variables") do |row|
            vars[row[0]] = row[1]
          end
          vars
        end

        def transaction(&block)
          @db_lock.synchronize do
            @db.transaction(&block)
          end
        end

        def close
          @db.close if @db && !@db.closed?
        end

        def undo_last_turn
          last_user_id = @db.get_first_value("SELECT id FROM events WHERE phase = 'user' ORDER BY id DESC LIMIT 1")
          return false unless last_user_id

          transaction do
            # Move events to undone_events
            @db.execute("INSERT INTO undone_events SELECT * FROM events WHERE id >= ?", [last_user_id])
            @db.execute("DELETE FROM events WHERE id >= ?", [last_user_id])

            # Move summaries to undone_summaries
            @db.execute("INSERT INTO undone_summaries SELECT * FROM summaries WHERE source_event_id >= ?", [last_user_id])
            @db.execute("DELETE FROM summaries WHERE source_event_id >= ?", [last_user_id])
          end
          true
        end

        def redo_last_turn
          # Find the earliest user event in undone_events
          next_user_id = @db.get_first_value("SELECT MIN(id) FROM undone_events WHERE phase = 'user'")
          return false unless next_user_id

          # Find the next user event after that (if any) to define the range
          following_user_id = @db.get_first_value("SELECT MIN(id) FROM undone_events WHERE phase = 'user' AND id > ?", [next_user_id])

          transaction do
            if following_user_id
              # Restore a single turn (range [next_user_id, following_user_id))
              @db.execute("INSERT INTO events SELECT * FROM undone_events WHERE id >= ? AND id < ?", [next_user_id, following_user_id])
              @db.execute("DELETE FROM undone_events WHERE id >= ? AND id < ?", [next_user_id, following_user_id])

              @db.execute("INSERT INTO summaries SELECT * FROM undone_summaries WHERE source_event_id >= ? AND source_event_id < ?",
                          [next_user_id, following_user_id])
              @db.execute("DELETE FROM undone_summaries WHERE source_event_id >= ? AND source_event_id < ?", [next_user_id, following_user_id])
            else
              # Restore everything from next_user_id onwards (tail)
              @db.execute("INSERT INTO events SELECT * FROM undone_events WHERE id >= ?", [next_user_id])
              @db.execute("DELETE FROM undone_events WHERE id >= ?", [next_user_id])

              @db.execute("INSERT INTO summaries SELECT * FROM undone_summaries WHERE source_event_id >= ?", [next_user_id])
              @db.execute("DELETE FROM undone_summaries WHERE source_event_id >= ?", [next_user_id])
            end
          end
          true
        end

        private

        def resolve_db_path(config)
          if config[:db_path]
            File.expand_path(config[:db_path])
          else
            project_path = config[:project_path] || "."
            Aura::PathResolver.session_db_path(project_path)
          end
        end

        def init_db
          FileUtils.mkdir_p(File.dirname(@db_path))
          @db = SQLite3::Database.new(@db_path)
          @db.execute("PRAGMA journal_mode=WAL")
          @db.execute("PRAGMA synchronous=NORMAL")
          create_tables
          migrate_tables
        end

        def create_tables
          @db.execute <<-SQL
            CREATE TABLE IF NOT EXISTS events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp INTEGER,
              phase TEXT,
              tool TEXT,
              payload TEXT
            );
          SQL

          @db.execute <<-SQL
            CREATE TABLE IF NOT EXISTS summaries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp INTEGER,
              content TEXT,
              source_event_id INTEGER
            );
          SQL

          @db.execute <<-SQL
            CREATE TABLE IF NOT EXISTS variables (
              key TEXT PRIMARY KEY,
              value TEXT
            );
          SQL

          @db.execute <<-SQL
            CREATE TABLE IF NOT EXISTS undone_events (
              id INTEGER PRIMARY KEY,
              timestamp INTEGER,
              phase TEXT,
              tool TEXT,
              payload TEXT
            );
          SQL

          @db.execute <<-SQL
            CREATE TABLE IF NOT EXISTS undone_summaries (
              id INTEGER PRIMARY KEY,
              timestamp INTEGER,
              content TEXT,
              source_event_id INTEGER
            );
          SQL
        end

        def migrate_tables
          cols = @db.execute("PRAGMA table_info(summaries)").map { |r| r[1] }
          return if cols.include?("source_event_id")

          @db.execute("ALTER TABLE summaries ADD COLUMN source_event_id INTEGER")
        end
      end
    end
  end
end
