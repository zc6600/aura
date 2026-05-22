# frozen_string_literal: true

require "fileutils"

module Aura
  # Global configuration and repository management
  module GlobalConfig
    def self.repo_path
      if defined?(Aura) && Aura.respond_to?(:global_repo_path)
        Aura.global_repo_path
      else
        File.join(Dir.home, ".aura", "repo")
      end
    end

    # Global configuration file (~/.aura/config.yml)
    def self.config_path
      File.join(Dir.home, ".aura", "config.yml")
    end

    # Execute a Git command safely inside a directory
    def self.git_run(dir, *args)
      require "open3"
      out, err, status = Open3.capture3("git", "-C", dir, *args)
      { stdout: out.to_s, stderr: err.to_s, success: status.success? }
    end

    # Initialize the global repository if it does not exist,
    # copying standard templates and initializing it as a Git repository.
    def self.ensure_repo!
      repo = repo_path
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
end
