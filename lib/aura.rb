# frozen_string_literal: true

require "fileutils"
require "open3"
require "shellwords"
require "aura/errors"

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

  # Safe YAML file loader to prevent arbitrary code execution (CVE-2013-0156)
  def self.safe_load_yaml(path)
    return {} unless File.exist?(path)
    begin
      # Use safe_load to prevent arbitrary object instantiation
      if Gem::Version.new(RUBY_VERSION) >= Gem::Version.new("3.1.0")
        YAML.safe_load_file(path, permitted_classes: [Symbol])
      else
        YAML.safe_load(File.read(path), permitted_classes: [Symbol])
      end || {}
    rescue StandardError
      {}
    end
  end

  # Resolve project workspace path by climbing parent directories.
  # If not in a workspace, guides the user to initialize a new workspace or falls back to a global sandbox.
  def self.resolve_project_path!(project_path)
    start_dir = project_path.to_s.strip.empty? ? Dir.pwd : project_path
    aura_dir = find_aura_dir(start_dir)
    if aura_dir
      File.dirname(aura_dir)
    else
      puts "\e[33m⚠️ Warning: Not in an Aura workspace (no .aura folder found in parent directories).\e[0m"
      
      use_sandbox = true
      begin
        # Prompt only if TTY is available
        if $stdin.tty? || File.exist?("/dev/tty")
          tty_in = File.exist?("/dev/tty") ? File.open("/dev/tty", "r") : $stdin
          tty_out = File.exist?("/dev/tty") ? File.open("/dev/tty", "w") : $stdout
          
          tty_out.print "❓ Would you like to initialize a new Aura workspace in the current directory? (y/N): "
          response = tty_in.gets.to_s.strip.downcase
          
          tty_in.close if tty_in != $stdin
          tty_out.close if tty_out != $stdout
          
          if response == "y" || response == "yes"
            use_sandbox = false
          end
        end
      rescue StandardError
        # Default to sandbox on any TTY prompt issue
      end
      
      if use_sandbox
        sandbox_path = File.join(Dir.home, ".aura", "sandbox")
        sandbox_aura = File.join(sandbox_path, ".aura")
        
        puts "\e[34mℹ️ Routing to global sandbox workspace: #{sandbox_path}\e[0m"
        
        unless File.directory?(sandbox_aura)
          FileUtils.mkdir_p(sandbox_path)
          ensure_global_repo!
          
          puts "Initializing global sandbox workspace..."
          out, err, status = Open3.capture3("git", "clone", global_repo_path, sandbox_aura)
          if status.success?
            git_run(sandbox_aura, "config", "user.name", "Aura Sandbox")
            git_run(sandbox_aura, "config", "user.email", "sandbox@aura-os.ai")
            
            # Inject .gitignore rule inside .aura folder to ignore runtime databases
            inner_ignore_path = File.join(sandbox_aura, ".gitignore")
            inner_rules = File.exist?(inner_ignore_path) ? File.read(inner_ignore_path) : ""
            unless inner_rules.include?("state/aura.db*")
              File.write(inner_ignore_path, inner_rules + "\nstate/aura.db*\n")
            end
            
            # Record sandbox project
            register_project!("sandbox", sandbox_path)
            
            # Record sandbox project name in config
            cfg_path = File.join(sandbox_aura, "config", "config.yml")
            if File.exist?(cfg_path)
              begin
                require "yaml"
                cfg = YAML.load_file(cfg_path) || {}
                cfg["project_name"] = "sandbox"
                File.write(cfg_path, YAML.dump(cfg))
              rescue StandardError
              end
            end
            puts "\e[32mGlobal sandbox workspace initialized successfully!\e[0m"
          else
            puts "\e[31m⛔️ Error: Failed to clone global templates into sandbox workspace:\n#{err}\e[0m"
            exit 1
          end
        end
        
        sandbox_path
      else
        target_dir = Dir.pwd
        project_name = File.basename(target_dir).gsub(/[^a-zA-Z0-9_\-]/, "")
        project_name = "aura_workspace" if project_name.empty?
        hidden = File.join(target_dir, ".aura")
        
        ensure_global_repo!
        
        puts "Initializing Aura workspace in-place at: #{target_dir}..."
        out, err, status = Open3.capture3("git", "clone", global_repo_path, hidden)
        if status.success?
          git_run(hidden, "config", "user.name", "Aura Workspace")
          git_run(hidden, "config", "user.email", "workspace@aura-os.ai")
          
          # Inject .gitignore rule in parent directory
          git_ignore_path = File.join(target_dir, ".gitignore")
          existing_rules = File.exist?(git_ignore_path) ? File.read(git_ignore_path) : ""
          unless existing_rules.include?(".aura/")
            File.write(git_ignore_path, existing_rules + "\n.aura/\n")
            puts "\e[32mInjected .gitignore rule for hidden .aura environment.\e[0m"
          end
          
          # Inject .gitignore rule inside .aura folder to ignore runtime databases
          inner_ignore_path = File.join(hidden, ".gitignore")
          inner_rules = File.exist?(inner_ignore_path) ? File.read(inner_ignore_path) : ""
          unless inner_rules.include?("state/aura.db*")
            File.write(inner_ignore_path, inner_rules + "\nstate/aura.db*\n")
          end
          
          register_project!(project_name, target_dir)
          
          cfg_path = File.join(hidden, "config", "config.yml")
          if File.exist?(cfg_path)
            begin
              require "yaml"
              cfg = YAML.load_file(cfg_path) || {}
              cfg["project_name"] = project_name.to_s
              File.write(cfg_path, YAML.dump(cfg))
            rescue StandardError
            end
          end
          
          puts "\e[32mWorkspace initialized successfully!\e[0m"
          target_dir
        else
          puts "\e[31m⛔️ Error: Failed to initialize workspace:\n#{err}\e[0m"
          exit 1
        end
      end
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
