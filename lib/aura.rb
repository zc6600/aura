# frozen_string_literal: true

require "fileutils"
require "open3"
require "shellwords"
require "aura/errors"

# Load refactored modules
require "aura/path_resolver"
require "aura/global_config"
require "aura/project_registry"
require "aura/workspace_initializer"
require "aura/cli/ui"
require "aura/llm/http_client"

module Aura
  def self.environment_path(project_path)
    PathResolver.environment_path(project_path)
  end

  def self.workspace_path(project_path)
    PathResolver.workspace_path(project_path)
  end

  def self.find_aura_dir(start_dir = Dir.pwd)
    PathResolver.find_aura_dir(start_dir)
  end

  def self.resolve_project_path(project_path = nil)
    PathResolver.resolve_project_path(project_path)
  end

  def self.resolve_project_path!(project_path = nil)
    PathResolver.resolve_project_path!(project_path)
  end

  def self.safe_load_yaml(path)
    WorkspaceInitializer.safe_load_yaml(path)
  end

  def self.registered_projects
    ProjectRegistry.registered_projects
  end

  def self.register_project!(name, path)
    ProjectRegistry.register!(name, path)
  end

  def self.unregister_project!(name)
    ProjectRegistry.unregister!(name)
  end

  def self.global_repo_path
    File.join(Dir.home, ".aura", "repo")
  end

  def self.global_projects_config_path
    File.join(Dir.home, ".aura", "projects.yml")
  end

  def self.ensure_global_repo!
    GlobalConfig.ensure_repo!
  end

  def self.git_run(dir, *args)
    GlobalConfig.git_run(dir, *args)
  end
end
