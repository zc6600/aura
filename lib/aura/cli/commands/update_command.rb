# frozen_string_literal: true

require "thor"
require "fileutils"
require "open3"

module Aura
  module Commands
    class UpdateCommand < Thor
      map "." => "current"
      
      def self.exit_on_failure?
        true
      end

      desc "framework", "Update Aura framework from source or remote"
      method_option :force, type: :boolean, aliases: "-f", desc: "Force rebuild and bypass all caches"
      def framework
        puts "🔄 Updating Aura Framework..."
        
        # Priority 1: Detect if in source directory (developer workflow)
        if File.exist?("aura.gemspec")
          puts "📦 Building from local source..."
          
          if options[:force]
            puts "⚡ Force mode: clearing gem cache..."
            system("gem clean")
          end
          
          system("gem build aura.gemspec")
          gem_files = Dir.glob("aura-*.gem")
          if gem_files.any?
            system("gem install #{gem_files.last}")
            puts "\e[32m✓ Framework updated from source!\e[0m"
          else
            puts "\e[31m⛔️ Failed to build gem!\e[0m"
            exit 1
          end
        else
          # Priority 3: Update from RubyGems (with cache bypass if --force)
          puts "📦 Updating from RubyGems..."
          if options[:force]
            puts "⚡ Force mode: bypassing CDN cache..."
            system("gem update aura --clear-sources --source https://rubygems.org")
          else
            system("gem update aura")
          end
          puts "\e[32m✓ Framework updated!\e[0m"
        end
      end

      desc "status", "Check template update status for current project"
      def status
        aura_dir = ensure_workspace!
        global_repo = Aura::GlobalConfig.repo_path
        
        unless File.directory?(global_repo)
          puts "\e[31m⛔️ Global repo not found at #{global_repo}\e[0m"
          exit 1
        end
        
        puts "📊 Template Update Status\n"
        puts "=" * 60
        
        # Local commit info
        local_commit = Aura::GlobalConfig.git_run(aura_dir, "rev-parse", "HEAD")
        local_log = Aura::GlobalConfig.git_run(aura_dir, "log", "--oneline", "-1")
        
        # Remote commit info
        remote_commit = Aura::GlobalConfig.git_run(global_repo, "rev-parse", "HEAD")
        remote_log = Aura::GlobalConfig.git_run(global_repo, "log", "--oneline", "-1")
        
        puts "Local (.aura):"
        puts "  Commit: #{local_commit[:stdout].strip}"
        puts "  Message: #{local_log[:stdout].strip}"
        
        puts "\nGlobal (~/.aura/repo):"
        puts "  Commit: #{remote_commit[:stdout].strip}"
        puts "  Message: #{remote_log[:stdout].strip}"
        
        if local_commit[:stdout].strip == remote_commit[:stdout].strip
          puts "\n\e[32m✓ Your templates are up to date!\e[0m"
        else
          puts "\n\e[33m⚠️  Updates available from global repo!\e[0m"
          puts "Run 'aura pull' or 'aura update merge' to update."
          
          # Show pending commits
          diff = Aura::GlobalConfig.git_run(aura_dir, "log", "HEAD..origin/main", "--oneline")
          if diff[:stdout].strip.length > 0
            puts "\nPending commits:"
            puts diff[:stdout]
          end
        end
      end

      desc "all", "Update all sub-projects with latest templates"
      method_option :merge, type: :boolean, aliases: "-m", desc: "Use merge instead of pull"
      def all
        projects = Aura.registered_projects
        
        if projects.empty?
          puts "No registered projects found."
          return
        end
        
        puts "🔄 Updating #{projects.size} project(s)...\n"
        puts "=" * 60
        
        success_count = 0
        fail_count = 0
        
        projects.each do |name, path|
          puts "\n\e[1m[#{name}]\e[0m #{path}"
          
          aura_dir = File.join(path, ".aura")
          unless File.directory?(aura_dir)
            puts "  \e[33m⚠️  Skipped (no .aura directory)\e[0m"
            next
          end
          
          begin
            if options[:merge]
              # Use merge logic
              puts "  Merging updates..."
              merge_project(name, aura_dir)
            else
              # Simple pull
              res = Aura::GlobalConfig.git_run(aura_dir, "pull", "--no-edit", "origin", "main")
              if res[:success]
                puts "  \e[32m✓ Updated\e[0m"
                success_count += 1
              else
                first_line = res[:stderr].lines.first&.strip || "Unknown error"
                puts "  \e[31m✗ Failed: #{first_line}\e[0m"
                fail_count += 1
              end
            end
          rescue => e
            puts "  \e[31m✗ Error: #{e.message}\e[0m"
            fail_count += 1
          end
        end
        
        puts "\n" + "=" * 60
        puts "Summary:"
        puts "  \e[32m✓ Success: #{success_count}\e[0m"
        puts "  \e[31m✗ Failed: #{fail_count}\e[0m"
      end

      desc "project PATH_OR_NAME", "Update a single project by path or name"
      method_option :merge, type: :boolean, aliases: "-m", desc: "Use merge instead of pull"
      def project(path_or_name)
        projects = Aura.registered_projects
        
        # Try to find project by name first
        aura_dir = nil
        project_name = nil
        project_path = nil
        
        if projects[path_or_name]
          # Found by name
          project_name = path_or_name
          project_path = projects[path_or_name]
          aura_dir = File.join(project_path, ".aura")
        else
          # Try to find by path (normalize path)
          normalized_path = File.expand_path(path_or_name)
          projects.each do |name, path|
            if File.expand_path(path) == normalized_path
              project_name = name
              project_path = path
              aura_dir = File.join(path, ".aura")
              break
            end
          end
          
          # If not found in registry, check if it's a direct path to a workspace
          if aura_dir.nil? && File.directory?(normalized_path)
            potential_aura = File.join(normalized_path, ".aura")
            if File.directory?(potential_aura)
              project_name = File.basename(normalized_path)
              project_path = normalized_path
              aura_dir = potential_aura
            end
          end
        end
        
        if aura_dir.nil? || !File.directory?(aura_dir)
          puts "\e[31m⛔️ Error: Project '#{path_or_name}' not found or has no .aura directory\e[0m"
          exit 1
        end
        
        puts "\e[1m[#{project_name}]\e[0m #{project_path}\n"
        
        begin
          # Backup user config before update
          config_path = Aura::PathResolver.resolve_config_path(aura_dir)
          config_backup = nil
          if File.exist?(config_path)
            require "tmpdir"
            config_backup = File.join(Dir.tmpdir, "aura_config_backup_#{Process.pid}.yml")
            FileUtils.cp(config_path, config_backup)
            puts "  \e[33m⚠️  Backed up user config.yml\e[0m"
          end
          
          if options[:merge]
            puts "  Merging updates..."
            merge_project(project_name, aura_dir)
          else
            puts "  Pulling updates..."
            res = Aura::GlobalConfig.git_run(aura_dir, "pull", "--no-edit", "origin", "main")
            if res[:success]
              puts "  \e[32m✓ Updated\e[0m"
            else
              first_line = res[:stderr].lines.first&.strip || "Unknown error"
              puts "  \e[31m✗ Failed: #{first_line}\e[0m"
            end
          end
          
          # Restore user config after update
          if config_backup && File.exist?(config_backup)
            FileUtils.cp(config_backup, config_path)
            FileUtils.rm(config_backup)
            puts "  \e[32m✓ Restored user config.yml\e[0m"
          end
        rescue => e
          puts "  \e[31m✗ Error: #{e.message}\e[0m"
          FileUtils.rm(config_backup) if config_backup && File.exist?(config_backup)
        end
      end

      desc "current", "Update current workspace templates (alias: aura update .)"
      method_option :merge, type: :boolean, aliases: "-m", desc: "Use merge instead of pull"
      def current
        aura_dir = ensure_workspace!
        project_path = File.dirname(aura_dir)
        project_name = File.basename(project_path)
        
        puts "\e[1m[#{project_name}]\e[0m #{project_path}\n"
        
        begin
          # Backup user config before update
          config_path = Aura::PathResolver.resolve_config_path(aura_dir)
          config_backup = nil
          if File.exist?(config_path)
            require "tmpdir"
            config_backup = File.join(Dir.tmpdir, "aura_config_backup_#{Process.pid}.yml")
            FileUtils.cp(config_path, config_backup)
            puts "  \e[33m⚠️  Backed up user config.yml\e[0m"
          end
          
          if options[:merge]
            puts "  Merging updates..."
            merge_project(project_name, aura_dir)
          else
            puts "  Pulling updates..."
            res = Aura::GlobalConfig.git_run(aura_dir, "pull", "--no-edit", "origin", "main")
            if res[:success]
              puts "  \e[32m✓ Updated\e[0m"
            else
              first_line = res[:stderr].lines.first&.strip || "Unknown error"
              puts "  \e[31m✗ Failed: #{first_line}\e[0m"
            end
          end
          
          # Restore user config after update
          if config_backup && File.exist?(config_backup)
            FileUtils.cp(config_backup, config_path)
            FileUtils.rm(config_backup)
            puts "  \e[32m✓ Restored user config.yml\e[0m"
          end
        rescue => e
          puts "  \e[31m✗ Error: #{e.message}\e[0m"
          # Clean up backup if exists
          FileUtils.rm(config_backup) if config_backup && File.exist?(config_backup)
        end
      end

      desc "merge", "Merge template updates from global repo with conflict resolution"
      method_option :stash, type: :boolean, aliases: "-s", desc: "Stash local changes before merge"
      method_option :force, type: :boolean, aliases: "-f", desc: "Force merge using theirs strategy"
      def merge
        aura_dir = ensure_workspace!
        
        puts "🔀 Merging template updates from global repo..."
        puts "=" * 60
        
        # Check for uncommitted changes
        status_out = Aura::GlobalConfig.git_run(aura_dir, "status", "--porcelain")
        has_changes = status_out[:stdout].strip.length > 0
        
        if has_changes
          if options[:force]
            # Force merge, prefer remote changes
            puts "\e[33m⚠️  Force merging (remote changes will override local)...\e[0m"
            res = Aura::GlobalConfig.git_run(aura_dir, "merge", "-X", "theirs", "origin/main")
            if res[:success]
              puts "\e[32m✓ Force merge completed!\e[0m"
              puts res[:stdout] if res[:stdout].strip.length > 0
            else
              puts "\e[31m⛔️ Merge failed!\e[0m"
              puts res[:stderr]
            end
            return
          elsif options[:stash]
            Aura::GlobalConfig.git_run(aura_dir, "stash")
            puts "\e[32m✓ Changes stashed.\e[0m"
          else
            puts "\e[33m⚠️  You have uncommitted changes in .aura/\e[0m"
            puts "\nOptions:"
            puts "  1. Commit changes first (recommended)"
            puts "  2. Use --stash to temporarily save changes"
            puts "  3. Use --force to override with remote changes"
            puts "\n\e[31m⛔️ Merge cancelled.\e[0m"
            exit 1
          end
        end
        
        # Execute pull and merge
        res = Aura::GlobalConfig.git_run(aura_dir, "pull", "--no-edit", "origin", "main")
        
        if res[:success]
          puts "\e[32m✓ Successfully merged template updates!\e[0m"
          puts res[:stdout]
          
          # Pop stash if applied
          if options[:stash]
            stash_res = Aura::GlobalConfig.git_run(aura_dir, "stash", "pop")
            if stash_res[:success]
              puts "\e[32m✓ Stashed changes restored.\e[0m"
            else
              puts "\e[33m⚠️  Failed to pop stash (may need manual resolution)\e[0m"
            end
          end
        else
          puts "\e[31m⛔️ Merge conflicts detected!\e[0m"
          puts "\nPlease resolve conflicts manually in .aura/ directory"
          puts "After resolving, run:"
          puts "  cd .aura && git add . && git commit -m 'Resolved merge conflicts'"
        end
      end

      private

      def ensure_workspace!
        aura_dir = Aura::PathResolver.find_aura_dir
        if aura_dir.nil?
          puts "\e[31m⛔️ Error: Not in an Aura workspace.\e[0m"
          puts "To initialize a workspace in the current directory, run:"
          puts "  $ aura new"
          exit 1
        end
        aura_dir
      end

      def merge_project(name, aura_dir)
        res = Aura::GlobalConfig.git_run(aura_dir, "pull", "--no-edit", "origin", "main")
        if res[:success]
          puts "  \e[32m✓ Updated\e[0m"
        else
          # Check if it's a conflict issue
          if res[:stderr].include?("CONFLICT")
            puts "  \e[31m✗ Merge conflicts (requires manual resolution)\e[0m"
          else
            first_line = res[:stderr].lines.first&.strip || "Unknown error"
            puts "  \e[31m✗ Failed: #{first_line}\e[0m"
          end
        end
      end
    end
  end
end
