require "json"
require "fileutils"
require "sqlite3"
require_relative "narrative_service"

module Aura
  module Kernel
    class State
      attr_reader :db_path

      def initialize(project_path)
        @project_path = (defined?(Aura) && Aura.respond_to?(:environment_path)) ? (Aura::PathResolver.environment_path(project_path) || project_path) : project_path
        @state_dir = File.join(@project_path, "state")
        env_db = ENV["AURA_STATE_DB_PATH"]
        @db_path = if env_db && !env_db.to_s.strip.empty?
          File.expand_path(env_db, @project_path)
        else
          # Resolve session name
          session_name = ENV["AURA_SESSION_NAME"]
          if session_name.nil? || session_name.to_s.strip.empty?
            active_txt = File.join(@state_dir, "active_session.txt")
            session_name = if File.exist?(active_txt)
              File.read(active_txt).strip rescue "default"
            else
              FileUtils.mkdir_p(@state_dir)
              File.write(active_txt, "default") rescue nil
              "default"
            end
          end
          session_name = "default" if session_name.to_s.strip.empty?

          # Backward compatibility: migrate legacy state/aura.db
          legacy_db = File.join(@state_dir, "aura.db")
          default_db = File.join(@state_dir, "sessions", "default.db")
          if File.exist?(legacy_db) && !File.exist?(default_db)
            FileUtils.mkdir_p(File.dirname(default_db))
            FileUtils.mv(legacy_db, default_db) rescue nil
          end

          File.join(@state_dir, "sessions", "#{session_name}.db")
        end
        FileUtils.mkdir_p(@state_dir)
        FileUtils.mkdir_p(File.dirname(@db_path))
        @db_lock = Mutex.new  # Protect database writes from concurrent access
        init_db
      end

      def record_event(payload)
        @db_lock.synchronize do
          @db.execute("INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)",
                      [Time.now.to_i, payload[:phase], payload[:tool], payload.to_json])
          @db.last_insert_row_id
        end
      end

      def metabolize_if_needed
        keep = fetch_recent_events_n || 20
        limit = fetch_max_chars
        count = @db.get_first_value("SELECT COUNT(*) FROM events").to_i
        total_chars = @db.get_first_value("SELECT COALESCE(SUM(LENGTH(payload)), 0) FROM events").to_i

        trigger = false
        trigger ||= (limit && limit.to_i > 0 && total_chars > limit.to_i)
        trigger ||= (count > keep * 5)

        if trigger && count > keep
          off = [keep - 1, 0].max
          
          rows = @db.execute("SELECT id, timestamp, phase, tool, payload FROM events WHERE id < (SELECT id FROM events ORDER BY id DESC LIMIT 1 OFFSET ?) ORDER BY id ASC", [off])
          old_events = rows.map do |id, ts, phase, tool, payload|
            obj = begin JSON.parse(payload) rescue nil end
            { "id" => id, "timestamp" => ts, "phase" => phase, "tool" => tool, "payload" => obj || payload }
          end

          if old_events.any?
            narrative = NarrativeService.new(@project_path).synthesize(old_events)
            record_summary("Metabolism: Narrative Summary - #{narrative}")
          end

          @db.execute("DELETE FROM events WHERE id < (SELECT id FROM events ORDER BY id DESC LIMIT 1 OFFSET ?)", [off])
          record_summary("Metabolism: Cleared old events. Kept last #{keep}.")
        end
      end

      def get_latest_summary
        @db.get_first_value("SELECT content FROM summaries ORDER BY timestamp DESC LIMIT 1")
      end

      def get_recent_summaries(limit = nil)
        n = limit || fetch_keep_last_summary_n_steps || 1
        entries = []
        @db.execute("SELECT content FROM summaries ORDER BY timestamp DESC LIMIT ?", [n]) do |row|
          entries << row[0]
        end
        entries.reverse.join("\n")
      end

      def get_recent_summaries_structured(limit: nil)
        n = limit || fetch_keep_last_summary_n_steps || 1
        rows = @db.execute("SELECT id, timestamp, content, source_event_id FROM (SELECT id, timestamp, content, source_event_id FROM summaries ORDER BY id DESC LIMIT ?) ORDER BY id ASC", [n])
        rows.map do |id, ts, content, source_event_id|
          { "id" => id, "timestamp" => ts, "content" => content, "source_event_id" => source_event_id }
        end
      end

      def get_active_variables
        vars = {}
        @db.execute("SELECT key, value FROM variables") do |row|
          vars[row[0]] = row[1]
        end
        vars
      end

      def set_variable(key, value)
        @db_lock.synchronize do
          @db.execute("INSERT OR REPLACE INTO variables (key, value) VALUES (?, ?)", [key, value.to_s])
        end
      end

      def get_recent_events
        n = fetch_recent_events_n || 20
        rows = @db.execute("SELECT payload FROM (SELECT id, payload FROM events ORDER BY id DESC LIMIT ?) ORDER BY id ASC", [n])
        rows.map { |r| r[0] }.join("\n")
      end

      def commit_summary(content, source_event_id = nil)
        record_summary(content, source_event_id)
      end

      def current_turn
        @db.get_first_value("SELECT COUNT(*) FROM summaries") || 0
      end

      def undo_last_turn
        last_user_id = @db.get_first_value("SELECT id FROM events WHERE phase = 'user' ORDER BY id DESC LIMIT 1")
        return false unless last_user_id

        @db.transaction do
          # Move events to undone_events
          @db.execute("INSERT INTO undone_events SELECT * FROM events WHERE id >= ?", [last_user_id])
          @db.execute("DELETE FROM events WHERE id >= ?", [last_user_id])
          
          # Move summaries to undone_summaries
          # Summaries might have source_event_id linking to the user event or subsequent events
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

        @db.transaction do
          if following_user_id
            # Restore a single turn (range [next_user_id, following_user_id))
            @db.execute("INSERT INTO events SELECT * FROM undone_events WHERE id >= ? AND id < ?", [next_user_id, following_user_id])
            @db.execute("DELETE FROM undone_events WHERE id >= ? AND id < ?", [next_user_id, following_user_id])
            
            @db.execute("INSERT INTO summaries SELECT * FROM undone_summaries WHERE source_event_id >= ? AND source_event_id < ?", [next_user_id, following_user_id])
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

      def init_db
        @db = SQLite3::Database.new(@db_path)
        @db.execute("PRAGMA journal_mode=WAL")
        @db.execute("PRAGMA synchronous=NORMAL")
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
        # Undone tables for history management
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
        
        cols = @db.execute("PRAGMA table_info(summaries)").map { |r| r[1] }
        unless cols.include?("source_event_id")
          @db.execute("ALTER TABLE summaries ADD COLUMN source_event_id INTEGER")
        end
      end

      def record_summary(content, source_event_id = nil)
        @db_lock.synchronize do
          @db.execute("INSERT INTO summaries (timestamp, content, source_event_id) VALUES (?, ?, ?)", [Time.now.to_i, content, source_event_id])
        end
      end

      def read_config
        cfg = File.join(@project_path, "config", "config.yml")
        return {} unless File.exist?(cfg)
        m = File.mtime(cfg).to_i rescue 0
        if defined?(@cached_cfg) && @cached_cfg && @cached_cfg_mtime == m
          @cached_cfg
        else
          begin
            require "yaml"
            @cached_cfg = Aura.safe_load_yaml(cfg) || {}
            @cached_cfg_mtime = m
            @cached_cfg
          rescue StandardError
            @cached_cfg = {}
            @cached_cfg_mtime = m
            {}
          end
        end
      end

      def fetch_max_chars
        data = read_config
        data.dig("state_management", "max_state_chars")
      end

      def fetch_keep_last_summary_n_steps
        data = read_config
        data.dig("state_management", "keep_last_summary_n_steps")
      end

      def fetch_recent_events_n
        data = read_config
        data.dig("state_management", "recent_events_n")
      end

      def get_recent_events_structured(limit: nil, phases: nil, tools: nil, since_ts: nil)
        n = limit || fetch_recent_events_n || 20
        conds = []
        args = []
        if phases && !phases.empty?
          conds << "phase IN (#{(["?"] * phases.size).join(',')})"
          args += phases
        end
        if tools && !tools.empty?
          conds << "tool IN (#{(["?"] * tools.size).join(',')})"
          args += tools
        end
        if since_ts
          conds << "timestamp >= ?"
          args << since_ts.to_i
        end
        where = conds.empty? ? "" : "WHERE #{conds.join(' AND ')}"
        rows = @db.execute("SELECT id, timestamp, phase, tool, payload FROM (SELECT * FROM events #{where} ORDER BY id DESC LIMIT ?) ORDER BY id ASC", args + [n])
        rows.map do |id, ts, phase, tool, payload|
          obj = begin JSON.parse(payload) rescue nil end
          { "id" => id, "timestamp" => ts, "phase" => phase, "tool" => tool, "payload" => obj || payload }
        end
      end

      def close
        @db.close if @db && !@db.closed?
      end
    end
  end
end
