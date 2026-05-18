# frozen_string_literal: true

require "fileutils"
require "open3"
require "shellwords"

module Aura
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

  # Global template repository path (~/.aura/repo)
  def self.global_repo_path
    File.join(Dir.home, ".aura", "repo")
  end

  # Global configuration file (~/.aura/config.yml)
  def self.global_config_path
    File.join(Dir.home, ".aura", "config.yml")
  end

  # Execute a Git command safely inside a directory
  def self.git_run(dir, *args)
    out, err, status = Open3.capture3("git", "-C", dir, *args)
    { stdout: out.to_s, stderr: err.to_s, success: status.success? }
  end

  # Initialize the global repository if it does not exist,
  # copying standard templates and initializing it as a Git repository.
  def self.ensure_global_repo!
    repo = global_repo_path
    return if File.directory?(File.join(repo, ".git"))

    FileUtils.mkdir_p(repo)

    # Copy default templates from the gem directory
    gem_templates = File.expand_path("aura/generators/aura/app/templates", __dir__)
    if File.directory?(gem_templates)
      FileUtils.cp_r(File.join(gem_templates, "."), repo)
    end

    # Initialize global repo as a Git repository so local .aura folders can remote clone/pull/push
    git_run(repo, "init")
    git_run(repo, "config", "user.name", "Aura CLI")
    git_run(repo, "config", "user.email", "support@aura-os.ai")
    git_run(repo, "config", "receive.denyCurrentBranch", "updateInstead")
    
    # Check if git version supports checkout -b
    git_run(repo, "checkout", "-b", "main")
    git_run(repo, "add", ".")
    git_run(repo, "commit", "-m", "Initial template commit")
    
    # Ensure branch is explicitly main
    git_run(repo, "branch", "-M", "main")
  end
end
