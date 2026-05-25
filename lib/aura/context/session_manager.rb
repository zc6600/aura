# frozen_string_literal: true

require "fileutils"
require "json"
require "time"

module Aura
  module Context
    # SessionManager: Manages conversation sessions at the application layer
    #
    # Each session is an independent SQLite database stored in state/sessions/
    # This provides natural isolation without virtualization.
    #
    # Usage:
    #   # Create and switch to a new session
    #   session = SessionManager.new(project_path)
    #   session.create("research-task")
    #   session.activate("research-task")
    #
    #   # List all sessions
    #   session.list  # => [{name: "default", ...}, {name: "research-task", ...}]
    #
    #   # Get current session db path
    #   session.current_db_path  # => "/path/to/state/sessions/research-task.db"
    #
    # Then pass to Runner:
    #   ENV["AURA_STATE_DB_PATH"] = session.current_db_path
    #   runner = Runner.new(project_path)
    class SessionManager
      attr_reader :project_path, :state_dir

      def initialize(project_path)
        env_path = defined?(Aura) && Aura.respond_to?(:environment_path) ? (Aura::PathResolver.environment_path(project_path) || project_path) : project_path
        @project_path = File.expand_path(env_path)
        @state_dir = File.join(@project_path, "state")
        @sessions_dir = File.join(@state_dir, "sessions")
        @metadata_file = File.join(@state_dir, "sessions.json")
        FileUtils.mkdir_p(@sessions_dir)
      end

      # Create a new session
      # @param name [String] Session name (unique identifier)
      # @param metadata [Hash] Optional metadata (description, tags, etc.)
      # @return [Hash] Session info
      def create(name, metadata = {})
        validate_session_name(name)

        raise ArgumentError, "Session '#{name}' already exists" if File.exist?(db_path_for(name))

        db_path = db_path_for(name)

        begin
          require "aura/memory"
          Aura::Memory::Stores::SQLiteStore.new(db_path: db_path).close
        rescue StandardError => e
          warn "[SessionManager] Failed to initialize session DB: #{e.message}"
          # Fallback: create empty file
          FileUtils.touch(db_path)
        end

        session_info = {
          name: name,
          db_path: db_path,
          created_at: Time.now.iso8601,
          last_active_at: Time.now.iso8601,
          description: metadata[:description] || "",
          tags: metadata[:tags] || [],
          turn_count: 0,
          event_count: 0
        }

        # Register in metadata
        sessions = load_metadata
        sessions[name] = session_info
        save_metadata(sessions)

        session_info
      end

      # Check if a session exists
      # @param name [String] Session name
      # @return [Boolean]
      def exists?(name)
        File.exist?(db_path_for(name)) || load_metadata.key?(name)
      end

      # Activate a session (set as current)
      # @param name [String] Session name
      # @return [String] Database path
      def activate(name)
        raise ArgumentError, "Session '#{name}' does not exist" unless exists?(name)

        # Update active session file (for State class to read)
        active_file = File.join(@state_dir, "active_session.txt")
        File.write(active_file, name)

        # Update last_active_at in metadata
        sessions = load_metadata
        if sessions[name]
          sessions[name][:last_active_at] = Time.now.iso8601
          save_metadata(sessions)
        end

        # Set environment variable for current process
        ENV["AURA_SESSION_NAME"] = name
        ENV["AURA_STATE_DB_PATH"] = nil # Clear direct path, let State resolve from session name

        db_path_for(name)
      end

      # Get current session name
      # @return [String, nil]
      def current_name
        active_file = File.join(@state_dir, "active_session.txt")
        return nil unless File.exist?(active_file)

        File.read(active_file).strip
      rescue StandardError
        nil
      end

      # Get current session database path
      # @return [String, nil]
      def current_db_path
        name = current_name
        name ? db_path_for(name) : nil
      end

      # List all sessions
      # @param include_missing [Boolean] Include sessions whose db files are missing
      # @return [Array<Hash>] Session info list
      def list(include_missing: false)
        sessions_hash = load_metadata

        # Auto-discover any session databases present in the directory
        if Dir.exist?(@sessions_dir)
          Dir.glob(File.join(@sessions_dir, "*.db")).each do |db_path|
            name = File.basename(db_path, ".db")
            name_sym = name.to_sym
            next if sessions_hash.key?(name_sym)

            sessions_hash[name_sym] = {
              name: name,
              db_path: db_path,
              created_at: begin
                File.birthtime(db_path).iso8601
              rescue StandardError
                File.mtime(db_path).iso8601
              end,
              last_active_at: File.mtime(db_path).iso8601,
              description: name == "default" ? "Default session" : "Auto-discovered session",
              tags: [],
              turn_count: 0,
              event_count: 0
            }
          end
          save_metadata(sessions_hash)
        end

        sessions = sessions_hash.values

        # Enrich with current stats
        sessions.map! do |info|
          if File.exist?(info[:db_path])
            stats = get_session_stats(info[:db_path])
            info.merge(stats)
          else
            info
          end
        rescue StandardError
          info
        end

        # Filter out missing dbs if requested
        include_missing ? sessions : sessions.select { |s| File.exist?(s[:db_path]) }
      end

      # Delete a session
      # @param name [String] Session name
      # @return [Boolean] Success
      def delete(name)
        raise ArgumentError, "Session '#{name}' does not exist" unless exists?(name)

        db_path = db_path_for(name)

        # Delete database file
        File.delete(db_path) if File.exist?(db_path)

        # Remove from metadata
        sessions = load_metadata
        sessions.delete(name)
        save_metadata(sessions)

        true
      end

      # Rename a session
      # @param old_name [String] Current session name
      # @param new_name [String] New session name
      # @return [Hash] Updated session info
      def rename(old_name, new_name)
        validate_session_name(new_name)

        raise ArgumentError, "Session '#{old_name}' does not exist" unless exists?(old_name)

        raise ArgumentError, "Session '#{new_name}' already exists" if File.exist?(db_path_for(new_name))

        old_db = db_path_for(old_name)
        new_db = db_path_for(new_name)

        # Rename database file
        FileUtils.mv(old_db, new_db) if File.exist?(old_db)

        # Update metadata
        sessions = load_metadata
        info = sessions.delete(old_name)
        if info
          info[:name] = new_name
          info[:db_path] = new_db
          sessions[new_name] = info
          save_metadata(sessions)
        end

        # Update active session if needed
        activate(new_name) if current_name == old_name

        info
      end

      # Duplicate a session (useful for branching experiments)
      # @param source_name [String] Source session name
      # @param new_name [String] New session name
      # @return [Hash] New session info
      def duplicate(source_name, new_name)
        raise ArgumentError, "Session '#{source_name}' does not exist" unless exists?(source_name)

        raise ArgumentError, "Session '#{new_name}' already exists" if File.exist?(db_path_for(new_name))

        source_db = db_path_for(source_name)
        new_db = db_path_for(new_name)

        # Copy database file
        FileUtils.cp(source_db, new_db)

        # Create metadata entry
        session_info = {
          name: new_name,
          db_path: new_db,
          created_at: Time.now.iso8601,
          last_active_at: Time.now.iso8601,
          description: "Duplicate of #{source_name}",
          tags: [],
          turn_count: 0,
          event_count: 0
        }

        sessions = load_metadata
        sessions[new_name] = session_info
        save_metadata(sessions)

        session_info
      end

      # Export session data for backup/sharing
      # @param name [String] Session name
      # @param dest_path [String] Destination path
      def export(name, dest_path)
        raise ArgumentError, "Session '#{name}' does not exist" unless exists?(name)

        FileUtils.mkdir_p(File.dirname(dest_path))
        FileUtils.cp(db_path_for(name), dest_path)
      end

      # Import session data from backup
      # @param source_path [String] Source db file path
      # @param name [String] Session name to create
      # @return [Hash] Session info
      def import(source_path, name)
        raise ArgumentError, "Source file '#{source_path}' does not exist" unless File.exist?(source_path)

        raise ArgumentError, "Session '#{name}' already exists" if File.exist?(db_path_for(name))

        FileUtils.cp(source_path, db_path_for(name))

        # Create metadata entry
        session_info = {
          name: name,
          db_path: db_path_for(name),
          created_at: Time.now.iso8601,
          last_active_at: Time.now.iso8601,
          description: "Imported from #{source_path}",
          tags: [],
          turn_count: 0,
          event_count: 0
        }

        sessions = load_metadata
        sessions[name] = session_info
        save_metadata(sessions)

        session_info
      end

      private

      def db_path_for(name)
        File.join(@sessions_dir, "#{name}.db")
      end

      def validate_session_name(name)
        raise ArgumentError, "Session name cannot be empty" if name.to_s.strip.empty?

        raise ArgumentError, "Session name cannot contain path separators" if name.include?("/") || name.include?("\\")

        return unless name.include?("..")

        raise ArgumentError, "Session name cannot contain '..'"
      end

      def load_metadata
        return {} unless File.exist?(@metadata_file)

        JSON.parse(File.read(@metadata_file), symbolize_names: true)
      rescue StandardError
        {}
      end

      def save_metadata(sessions)
        File.write(@metadata_file, JSON.pretty_generate(sessions))
      rescue StandardError => e
        warn "[SessionManager] Failed to save metadata: #{e.message}"
      end

      def get_session_stats(db_path)
        require "sqlite3"
        db = SQLite3::Database.new(db_path)

        event_count = db.get_first_value("SELECT COUNT(*) FROM events").to_i
        summary_count = db.get_first_value("SELECT COUNT(*) FROM summaries").to_i
        last_timestamp = db.get_first_value("SELECT MAX(timestamp) FROM events")

        db.close

        {
          event_count: event_count,
          summary_count: summary_count,
          turn_count: (event_count / 3.0).ceil, # Rough estimate: user + plan + execution
          last_event_at: last_timestamp ? Time.at(last_timestamp.to_i).iso8601 : nil
        }
      rescue StandardError
        {}
      end
    end
  end
end
