# frozen_string_literal: true

require "thor"
require "fileutils"

module Aura
  module Commands
    class ProjectCommand < Thor
      def self.exit_on_failure?
        true
      end

      desc "list", "List all globally registered Aura projects and their status"
      def list
        projects = Aura.registered_projects
        if projects.empty?
          puts "No Aura projects registered yet. Run 'aura new <project_name>' to register a workspace."
          return
        end

        puts "Registered Aura Projects:"
        puts "-" * 80
        printf "%-20s %-45s %-15s\n", "Name", "Path", "Status"
        puts "-" * 80

        projects.each do |name, path|
          status = File.directory?(File.join(path, ".aura")) ? "\e[32mActive\e[0m" : "\e[31mMissing (.aura folder not found)\e[0m"
          printf "%-20s %-45s %-15s\n", name, path, status
        end
        puts "-" * 80
      end

      desc "delete PROJECT_NAME", "Unregister an Aura project and cleanly delete its local .aura sandbox"
      def delete(project_name)
        projects = Aura.registered_projects
        path = projects[project_name.to_s]

        if path.nil?
          puts "\e[31m⛔️ Error: Project '#{project_name}' is not registered globally.\e[0m"
          exit 1
        end

        puts "⚠️ WARNING: You are about to delete project '#{project_name}'."
        puts "   - Registered Path: #{path}"

        hidden = File.join(path, ".aura")
        physical_exists = File.directory?(hidden)
        if physical_exists
          puts "   - Local environment (.aura/) will be physically deleted."
        else
          puts "   - Local environment (.aura/) does not exist physically (already deleted or moved)."
        end

        if Aura::CLI::UI.confirm?("❓ Are you sure you want to proceed?")
          if physical_exists
            begin
              FileUtils.rm_rf(hidden)
              puts "\e[32mSuccessfully deleted physical sandbox at #{hidden}.\e[0m"
            rescue StandardError => e
              puts "\e[31mFailed to delete physical sandbox: #{e.message}\e[0m"
            end
          end

          if Aura.unregister_project!(project_name)
            puts "\e[32mProject '#{project_name}' has been successfully unregistered globally.\e[0m"
          else
            puts "\e[31mFailed to unregister project '#{project_name}' from global projects registry.\e[0m"
          end
        else
          puts "Deletion cancelled."
        end
      end

      desc "register PROJECT_NAME", "Register the current directory as an active Aura project globally"
      def register(project_name)
        aura_dir = ensure_workspace!
        workspace_root = File.dirname(aura_dir)

        # Register in projects registry
        Aura.register_project!(project_name, workspace_root)

        # Write project name to local config
        cfg_path = Aura::PathResolver.resolve_config_path(aura_dir)
        begin
          cfg = File.exist?(cfg_path) ? (YAML.load_file(cfg_path) || {}) : {}
          cfg["project_name"] = project_name.to_s
          File.write(cfg_path, YAML.dump(cfg))
        rescue StandardError
        end

        puts "\e[32mSuccessfully registered workspace at #{workspace_root} as '#{project_name}'!\e[0m"
      end

      desc "prune", "Remove all registered projects whose physical directories no longer exist"
      def prune
        projects = Aura.registered_projects
        if projects.empty?
          puts "No projects registered."
          return
        end

        pruned_count = 0
        projects.each do |name, path|
          next if File.directory?(File.join(path, ".aura"))

          Aura.unregister_project!(name)
          puts "\e[33mPruned missing project '#{name}' (path: #{path})\e[0m"
          pruned_count += 1
        end

        if pruned_count.positive?
          puts "\e[32mSuccessfully pruned #{pruned_count} missing project(s)!\e[0m"
        else
          puts "No missing projects to prune."
        end
      end

      private

      def ensure_workspace!
        Aura::PathResolver.ensure_workspace!(Dir.pwd)
      end
    end
  end
end
