# frozen_string_literal: true

require "sqlite3"
require "fileutils"
require_relative "../store"

module Aura
  module Memory
    module Stores
      class SQLiteStore < Store
        def initialize(config = {})
          @db_path = resolve_db_path(config)
          @db_lock = Mutex.new
          init_db
        end

        def insert_event(timestamp:, phase:, tool:, payload:)
          if @in_transaction
            @db.execute(
              "INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)",
              [timestamp, phase, tool, serialize_payload(payload)]
            )
            @db.last_insert_row_id
          else
            @db_lock.synchronize do
              @db.execute(
                "INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)",
                [timestamp, phase, tool, serialize_payload(payload)]
              )
              @db.last_insert_row_id
            end
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

          query << " WHERE #{conditions.join(" AND ")}" unless conditions.empty?
          query << " ORDER BY id ASC"
          query << " LIMIT ?" if limit
          args << limit if limit

          if offset
            query << " OFFSET ?"
            args << offset
          end

          rows = @db.execute(query, args)
          rows.map do |id, ts, phase, tool, payload|
            {
              "id" => id,
              "timestamp" => ts,
              "phase" => phase,
              "tool" => tool,
              "payload" => deserialize_payload(payload)
            }
          end
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
          query = +"SELECT id, timestamp, content, source_event_id FROM summaries ORDER BY id ASC"
          query << " LIMIT ?" if limit
          args = limit ? [limit] : []

          rows = @db.execute(query, args)
          rows.map do |id, ts, content, source_event_id|
            {
              "id" => id,
              "timestamp" => ts,
              "content" => content,
              "source_event_id" => source_event_id
            }
          end
        end

        def set_variable(key:, value:)
          if @in_transaction
            @db.execute(
              "INSERT OR REPLACE INTO variables (key, value) VALUES (?, ?)",
              [key.to_s, value.to_s]
            )
          else
            @db_lock.synchronize do
              @db.execute(
                "INSERT OR REPLACE INTO variables (key, value) VALUES (?, ?)",
                [key.to_s, value.to_s]
              )
            end
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

        def transaction
          @db_lock.synchronize do
            begin
              @in_transaction = true
              @db.transaction { yield }
            ensure
              @in_transaction = false
            end
          end
        end

        def close
          @db.close if @db && !@db.closed?
        end

        private

        def resolve_db_path(config)
          if config[:db_path]
            File.expand_path(config[:db_path])
          else
            project_path = config[:project_path] || "."
            resolve_session_db_path(project_path)
          end
        end

        def resolve_session_db_path(project_path)
          state_dir = File.join(project_path, "state")
          env_db = ENV["AURA_STATE_DB_PATH"]

          return File.expand_path(env_db, project_path) if env_db && !env_db.to_s.strip.empty?

          session_name = resolve_session_name(state_dir)
          FileUtils.mkdir_p(File.join(state_dir, "sessions"))
          File.join(state_dir, "sessions", "#{session_name}.db")
        end

        def resolve_session_name(state_dir)
          session_name = ENV["AURA_SESSION_NAME"]
          return session_name if session_name && !session_name.to_s.strip.empty?

          active_txt = File.join(state_dir, "active_session.txt")
          if File.exist?(active_txt)
            File.read(active_txt).strip rescue "default"
          else
            FileUtils.mkdir_p(state_dir)
            File.write(active_txt, "default") rescue nil
            "default"
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
