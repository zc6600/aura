# frozen_string_literal: true

require "fileutils"

module Aura
  # Path resolution utilities for workspace and environment detection
  module PathResolver
    # Find the environment path for a given workspace path.
    # If workspace_path/.aura exists, it is the environment root.
    # Otherwise, workspace_path itself is the environment root.
    def self.environment_path(project_path)
      return nil if project_path.nil?
      expanded = File.expand_path(project_path)
      hidden_dir = File.join(expanded, ".aura")
      if File.directory?(hidden_dir)
        hidden_dir
      else
        expanded
      end
    end

    # Find the workspace root path (parent of .aura if it exists).
    def self.workspace_path(project_path)
      return nil if project_path.nil?
      expanded = File.expand_path(project_path)
      if File.basename(expanded) == ".aura"
        File.dirname(expanded)
      elsif File.directory?(File.join(expanded, ".aura"))
        expanded
      else
        expanded
      end
    end

    # Climb parent directories to locate a valid .aura folder, avoiding global ~/.aura
    def self.find_aura_dir(start_dir = Dir.pwd)
      dir = File.expand_path(start_dir)
      loop do
        hidden = File.join(dir, ".aura")
        if File.directory?(hidden) && hidden != File.expand_path("~/.aura")
          return hidden
        end
        parent = File.dirname(dir)
        break if parent == dir
        dir = parent
      end
      nil
    end
    # Resolve the config.yml path inside an environment path.
    # Prioritizes env_path/config/config.yml, falling back to env_path/config.yml.
    def self.resolve_config_path(env_path)
      return nil if env_path.nil?
      subfolder_cfg = File.join(env_path, "config", "config.yml")
      if File.exist?(subfolder_cfg)
        subfolder_cfg
      else
        root_cfg = File.join(env_path, "config.yml")
        File.exist?(root_cfg) ? root_cfg : subfolder_cfg
      end
    end

    # Resolves the database file path for a given session.
    # Handles session directories, active session tracking, and migration of legacy files.
    def self.session_db_path(project_path, session_name = nil)
      env_path = environment_path(project_path || ".")
      state_dir = File.join(env_path, "state")
      
      env_db = ENV["AURA_STATE_DB_PATH"]
      return File.expand_path(env_db, env_path) if env_db && !env_db.to_s.strip.empty?

      resolved_session = session_name || ENV["AURA_SESSION_NAME"]
      if resolved_session.nil? || resolved_session.to_s.strip.empty?
        active_txt = File.join(state_dir, "active_session.txt")
        resolved_session = if File.exist?(active_txt)
          File.read(active_txt).strip rescue "default"
        else
          FileUtils.mkdir_p(state_dir)
          File.write(active_txt, "default") rescue nil
          "default"
        end
      end
      resolved_session = "default" if resolved_session.to_s.strip.empty?

      # Backward compatibility: migrate legacy state/aura.db to sessions/default.db
      legacy_db = File.join(state_dir, "aura.db")
      default_db = File.join(state_dir, "sessions", "default.db")
      if File.exist?(legacy_db) && !File.exist?(default_db)
        FileUtils.mkdir_p(File.dirname(default_db))
        begin
          FileUtils.mv(legacy_db, default_db)
        rescue => e
          $stderr.puts "[PathResolver] Migration failed: #{e.class}: #{e.message}"
        end
      end

      FileUtils.mkdir_p(File.join(state_dir, "sessions"))
      File.join(state_dir, "sessions", "#{resolved_session}.db")
    end
  end
end
