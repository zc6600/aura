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

  # Global projects registry file (~/.aura/projects.yml)
  def self.global_projects_config_path
    File.join(Dir.home, ".aura", "projects.yml")
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

  # Resolve project workspace path by climbing parent directories. Halts with error if not in a workspace.
  def self.resolve_project_path!(project_path)
    start_dir = project_path.to_s.strip.empty? ? Dir.pwd : project_path
    aura_dir = find_aura_dir(start_dir)
    if aura_dir
      File.dirname(aura_dir)
    else
      puts "\e[31m⛔️ Error: Not in an Aura workspace. No .aura folder found in parent directories.\e[0m"
      exit 1
    end
  end

  # Retrieve all registered projects as a Hash mapping name to absolute path
  def self.registered_projects
    cfg_path = global_projects_config_path
    return {} unless File.exist?(cfg_path)
    begin
      data = YAML.load_file(cfg_path)
      data.is_a?(Hash) && data["projects"] ? data["projects"] : {}
    rescue StandardError
      {}
    end
  end

  # Register a workspace path with a project name globally
  def self.register_project!(name, path)
    cfg_path = global_projects_config_path
    FileUtils.mkdir_p(File.dirname(cfg_path))
    begin
      require "yaml"
      data = File.exist?(cfg_path) ? (YAML.load_file(cfg_path) || {}) : {}
    rescue StandardError
      data = {}
    end
    data = {} unless data.is_a?(Hash)
    data["projects"] ||= {}
    data["projects"][name.to_s] = File.expand_path(path)
    File.write(cfg_path, YAML.dump(data))
  end

  # Unregister a project name globally
  def self.unregister_project!(name)
    cfg_path = global_projects_config_path
    return false unless File.exist?(cfg_path)
    begin
      require "yaml"
      data = YAML.load_file(cfg_path) || {}
    rescue StandardError
      return false
    end
    data = {} unless data.is_a?(Hash)
    data["projects"] ||= {}
    if data["projects"].delete(name.to_s)
      File.write(cfg_path, YAML.dump(data))
      true
    else
      false
    end
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

    # Ensure config.yml is placed in the config/ subfolder for workspace compatibility
    # If the target config file already exists (e.g. configured by setup.sh), deep-merge to preserve user settings.
    repo_config_dir = File.join(repo, "config")
    repo_config_file = File.join(repo, "config.yml")
    if File.exist?(repo_config_file)
      FileUtils.mkdir_p(repo_config_dir)
      target_config_file = File.join(repo_config_dir, "config.yml")
      if File.exist?(target_config_file)
        begin
          require "yaml"
          existing_cfg = YAML.load_file(target_config_file) || {}
          template_cfg = YAML.load_file(repo_config_file) || {}
          
          # Deep-merge existing_cfg (user choices) on top of template_cfg
          merged_cfg = template_cfg.merge(existing_cfg) do |key, oldval, newval|
            if oldval.is_a?(Hash) && newval.is_a?(Hash)
              oldval.merge(newval)
            else
              newval
            end
          end
          
          File.write(target_config_file, YAML.dump(merged_cfg))
          FileUtils.rm(repo_config_file)
        rescue StandardError
          FileUtils.mv(repo_config_file, target_config_file, force: true)
        end
      else
        FileUtils.mv(repo_config_file, target_config_file)
      end
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
