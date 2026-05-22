# frozen_string_literal: true

require "thor"
require "fileutils"
require "open3"
require "yaml"

module Aura
  module Commands
    class NewCommand < Thor
      def self.exit_on_failure?
        true
      end

      desc "[PATH]", "Initialize an Aura environment at the specified path (defaults to current directory)"
      def new(target_path = ".")
        Aura.ensure_global_repo!
        
        target_dir = File.expand_path(target_path)
        FileUtils.mkdir_p(target_dir) unless File.directory?(target_dir)
        
        project_name = File.basename(target_dir).gsub(/[^a-zA-Z0-9_\-]/, "")
        project_name = "aura_#{Time.now.strftime('%Y_%m_%d_%H%M%S')}" if project_name.empty?

        hidden = File.join(target_dir, ".aura")
        
        puts "Initializing Aura workspace in-place at: #{target_dir}..."
        
        if File.exist?(hidden)
          puts "\e[31m⛔️ Error: .aura environment already exists in this folder!\e[0m"
          exit 1
        end

        # Clone global repository into hidden .aura environment
        out, err, status = Open3.capture3("git", "clone", Aura::GlobalConfig.repo_path, hidden)
        if status.success?
          puts "\e[32mSuccessfully cloned template repository into hidden .aura environment.\e[0m"
          
          # Configure local workspace git context
          Aura::GlobalConfig.git_run(hidden, "config", "user.name", "Aura Workspace")
          Aura::GlobalConfig.git_run(hidden, "config", "user.email", "workspace@aura-os.ai")
          
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

          # Record project name in global projects registry
          Aura.register_project!(project_name, target_dir)

          # Record project name inside the local workspace configuration
          cfg_path = File.join(hidden, "config", "config.yml")
          if File.exist?(cfg_path)
            begin
              cfg = YAML.load_file(cfg_path) || {}
              cfg["project_name"] = project_name.to_s
              File.write(cfg_path, YAML.dump(cfg))
            rescue StandardError
            end
          end

          puts "\e[32mProject '#{project_name}' registered successfully!\e[0m"
        else
          puts "\e[31mFailed to clone global repository:\n#{err}\e[0m"
          exit 1
        end
      end
    end
  end
end
