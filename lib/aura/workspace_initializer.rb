# frozen_string_literal: true

require "fileutils"
require "open3"
require "yaml"

module Aura
  # Workspace initialization and project path resolution
  module WorkspaceInitializer
    # Resolve project workspace path by climbing parent directories.
    # If not in a workspace, guides the user to initialize a new workspace or falls back to a global sandbox.
    def self.resolve_project_path!(project_path)
      start_dir = project_path.to_s.strip.empty? ? Dir.pwd : project_path
      aura_dir = PathResolver.find_aura_dir(start_dir)
      
      if aura_dir
        File.dirname(aura_dir)
      else
        handle_no_workspace(start_dir)
      end
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

    private

    def self.handle_no_workspace(start_dir)
      puts "\e[33m⚠️ Warning: Not in an Aura workspace (no .aura folder found in parent directories).\e[0m"
      
      if defined?(Minitest) || ENV["RACK_ENV"] == "test" || ENV["RAILS_ENV"] == "test" || ENV["CI"] == "true"
        use_sandbox = true
      else
        use_sandbox = !Aura::CLI::UI.confirm?("❓ Would you like to initialize a new Aura workspace in the current directory?")
      end
      
      if use_sandbox
        initialize_sandbox
      else
        initialize_workspace_in_place(Dir.pwd)
      end
    end

    def self.initialize_sandbox
      sandbox_path = File.join(Dir.home, ".aura", "sandbox")
      sandbox_aura = File.join(sandbox_path, ".aura")
      
      puts "\e[34mℹ️ Routing to global sandbox workspace: #{sandbox_path}\e[0m"
      
      unless File.directory?(sandbox_aura)
        FileUtils.mkdir_p(sandbox_path)
        GlobalConfig.ensure_repo!
        
        puts "Initializing global sandbox workspace..."
        out, err, status = Open3.capture3("git", "clone", GlobalConfig.repo_path, sandbox_aura)
        if status.success?
          GlobalConfig.git_run(sandbox_aura, "config", "user.name", "Aura Sandbox")
          GlobalConfig.git_run(sandbox_aura, "config", "user.email", "sandbox@aura-os.ai")
          
          # Copy configuration file from global repo template
          src_cfg = Aura::PathResolver.resolve_config_path(GlobalConfig.repo_path)
          if src_cfg && File.exist?(src_cfg)
            dest_cfg = File.join(sandbox_aura, "config", "config.yml")
            FileUtils.mkdir_p(File.dirname(dest_cfg))
            FileUtils.cp(src_cfg, dest_cfg)
          end
          
          # Inject .gitignore rule inside .aura folder to ignore runtime databases
          inner_ignore_path = File.join(sandbox_aura, ".gitignore")
          inner_rules = File.exist?(inner_ignore_path) ? File.read(inner_ignore_path) : ""
          unless inner_rules.include?("state/aura.db*")
            File.write(inner_ignore_path, inner_rules + "\nstate/aura.db*\n")
          end
          
          # Record sandbox project
          ProjectRegistry.register!("sandbox", sandbox_path)
          
          # Record sandbox project name in config
          cfg_path = File.join(sandbox_aura, "config", "config.yml")
          if File.exist?(cfg_path)
            begin
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
    end

    def self.initialize_workspace_in_place(target_dir)
      project_name = File.basename(target_dir).gsub(/[^a-zA-Z0-9_\-]/, "")
      project_name = "aura_workspace" if project_name.empty?
      hidden = File.join(target_dir, ".aura")
      
      GlobalConfig.ensure_repo!
      
      puts "Initializing Aura workspace in-place at: #{target_dir}..."
      out, err, status = Open3.capture3("git", "clone", GlobalConfig.repo_path, hidden)
      if status.success?
        GlobalConfig.git_run(hidden, "config", "user.name", "Aura Workspace")
        GlobalConfig.git_run(hidden, "config", "user.email", "workspace@aura-os.ai")
        
        # Copy configuration file from global repo template
        src_cfg = Aura::PathResolver.resolve_config_path(GlobalConfig.repo_path)
        if src_cfg && File.exist?(src_cfg)
          dest_cfg = File.join(hidden, "config", "config.yml")
          FileUtils.mkdir_p(File.dirname(dest_cfg))
          FileUtils.cp(src_cfg, dest_cfg)
        end
        
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
        
        ProjectRegistry.register!(project_name, target_dir)
        
        cfg_path = File.join(hidden, "config", "config.yml")
        if File.exist?(cfg_path)
          begin
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
