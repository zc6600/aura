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
  end
end
