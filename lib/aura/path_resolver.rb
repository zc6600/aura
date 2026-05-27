# frozen_string_literal: true

require "fileutils"

module Aura
  # Path resolution utilities for workspace and environment detection
  module PathResolver
    # Security: Validate session name to prevent path traversal and injection
    MAX_SESSION_NAME_LENGTH = 64
    SESSION_NAME_PATTERN = /\A[a-zA-Z0-9][a-zA-Z0-9_-]*\z/

    # Security: Validate file paths to prevent traversal attacks
    def self.validate_safe_path(path, base_dir)
      expanded_base = File.expand_path(base_dir)
      expanded = File.expand_path(path, expanded_base)
      real = File.exist?(expanded) ? File.realpath(expanded) : expanded
      real_base = File.exist?(expanded_base) ? File.realpath(expanded_base) : expanded_base
      raise SecurityError, "Path traversal detected: #{path} escapes base directory #{base_dir}" unless real.start_with?(real_base)

      real
    end

    # Security: Sanitize and validate session name
    def self.sanitize_session_name(name)
      return "default" if name.nil? || name.to_s.strip.empty?

      name = name.to_s.strip

      # Check for path traversal attempts
      raise ArgumentError, "Session name cannot contain path separators" if name.include?("..") || name.include?("/") || name.include?("\\")

      # Length validation
      raise ArgumentError, "Session name too long (max #{MAX_SESSION_NAME_LENGTH} characters)" if name.length > MAX_SESSION_NAME_LENGTH

      # Pattern validation
      unless name.match?(SESSION_NAME_PATTERN)
        raise ArgumentError, "Session name must start with alphanumeric character and contain only letters, numbers, hyphens, and underscores"
      end

      name
    end

    # Validate port number for web server
    def self.validate_port(port)
      port = port.to_i
      raise ArgumentError, "Port must be between 0 and 65535" if port < 0 || port > 65_535

      warn "\e[33m⚠️  Warning: Port #{port} is a privileged port (< 1024). May require root privileges.\e[0m" if port > 0 && port < 1024
      port
    end

    # Validate max steps for agent loops
    MAX_STEPS_LIMIT = 1000
    def self.validate_max_steps(steps)
      steps = steps.to_i
      raise ArgumentError, "Max steps must be a positive number" if steps <= 0
      raise ArgumentError, "Max steps exceeds limit (#{MAX_STEPS_LIMIT})" if steps > MAX_STEPS_LIMIT

      steps
    end

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
      else
        expanded
      end
    end

    # Resolve project path with consistent behavior across all commands
    # This is the single source of truth for project path resolution
    def self.resolve_project_path(project_path = nil)
      start_dir = project_path.to_s.strip.empty? ? Dir.pwd : File.expand_path(project_path)
      aura_dir = find_aura_dir(start_dir)

      if aura_dir
        File.dirname(aura_dir)
      else
        # Return nil instead of raising - let caller decide how to handle
        nil
      end
    end

    # Resolve project path or handle no-workspace scenario
    def self.resolve_project_path!(project_path = nil)
      resolved = resolve_project_path(project_path)

      if resolved
        resolved
      else
        # Delegate to WorkspaceInitializer for interactive fallback
        require "aura/workspace_initializer"
        WorkspaceInitializer.resolve_project_path!(project_path)
      end
    end

    # Climb parent directories to locate a valid .aura folder, avoiding global ~/.aura
    def self.find_aura_dir(start_dir = Dir.pwd)
      dir = File.expand_path(start_dir)
      loop do
        hidden = File.join(dir, ".aura")
        return hidden if File.directory?(hidden) && hidden != File.expand_path("~/.aura")

        parent = File.dirname(dir)
        break if parent == dir

        dir = parent
      end
      nil
    end

    # Ensure starting from a workspace, otherwise print standard error and exit.
    def self.ensure_workspace!(start_dir = Dir.pwd)
      aura_dir = find_aura_dir(start_dir)
      if aura_dir.nil?
        warn "\e[31m⛔️ Error: Not in an Aura workspace (no .aura folder found in parent directories).\e[0m"
        warn "To initialize a workspace in the current directory, run:"
        warn "  $ aura new"
        exit 1
      end
      aura_dir
    end

    # Resolve the config.yml path inside an environment path.
    # Prioritizes env_path/config/config.yml, falling back to env_path/config.yml.
    def self.resolve_config_path(project_path_or_env_path)
      return nil if project_path_or_env_path.nil?

      env_path = environment_path(project_path_or_env_path) || File.expand_path(project_path_or_env_path)

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

      env_db = ENV.fetch("AURA_STATE_DB_PATH", nil)
      return File.expand_path(env_db, env_path) if env_db && !env_db.to_s.strip.empty?

      resolved_session = session_name || ENV.fetch("AURA_SESSION_NAME", nil)
      if resolved_session.nil? || resolved_session.to_s.strip.empty?
        active_txt = File.join(state_dir, "active_session.txt")
        resolved_session = if File.exist?(active_txt)
                             begin
                               File.read(active_txt).strip
                             rescue StandardError
                               "default"
                             end
                           else
                             FileUtils.mkdir_p(state_dir)
                             begin
                               File.write(active_txt, "default")
                             rescue StandardError
                               nil
                             end
                             "default"
                           end
      end
      resolved_session = "default" if resolved_session.to_s.strip.empty?
      resolved_session = sanitize_session_name(resolved_session)

      # Backward compatibility: migrate legacy state/aura.db to sessions/default.db
      legacy_db = File.join(state_dir, "aura.db")
      default_db = File.join(state_dir, "sessions", "default.db")
      if File.exist?(legacy_db) && !File.exist?(default_db)
        FileUtils.mkdir_p(File.dirname(default_db))
        begin
          FileUtils.mv(legacy_db, default_db)
        rescue StandardError => e
          warn "[PathResolver] Migration failed: #{e.class}: #{e.message}"
        end
      end

      FileUtils.mkdir_p(File.join(state_dir, "sessions"))
      File.join(state_dir, "sessions", "#{resolved_session}.db")
    end
  end
end
