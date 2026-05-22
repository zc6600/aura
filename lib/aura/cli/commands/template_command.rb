# frozen_string_literal: true

require "thor"
require "fileutils"
require "open3"

module Aura
  module Commands
    class TemplateCommand < Thor
      def self.exit_on_failure?
        true
      end

      desc "sync", "Sync template updates from Aura framework to global repo"
      def sync
        puts "📦 Syncing templates from framework to global repo (~/.aura/repo)..."
        puts "=" * 60
        
        # Find template path from gem installation directory
        # __dir__ is .../lib/aura/cli/commands, so ../.. = .../lib/aura
        lib_aura_path = File.expand_path("../..", __dir__)
        gem_templates = File.join(lib_aura_path, "generators/aura/app/templates")
        
        # Fallback to source path if running from source
        unless File.directory?(gem_templates)
          gem_templates = File.expand_path("aura/generators/aura/app/templates", 
                                           File.join(__dir__, "../../../../"))
        end
        
        global_repo = Aura::GlobalConfig.repo_path
        
        unless File.directory?(gem_templates)
          puts "\e[31m⛔️ Template source not found at: #{gem_templates}\e[0m"
          exit 1
        end
        
        # Backup user modifications
        puts "\n📋 Detecting user modifications..."
        if File.directory?(File.join(global_repo, ".git"))
          status_out = Aura::GlobalConfig.git_run(global_repo, "status", "--porcelain")
          if status_out[:stdout].strip.length > 0
            puts "  Found uncommitted changes, creating backup commit..."
            Aura::GlobalConfig.git_run(global_repo, "add", ".")
            Aura::GlobalConfig.git_run(global_repo, "commit", "-m", "Before template sync: user changes backup")
            puts "  \e[32m✓ Backup created\e[0m"
          end
        end
        
        # Sync templates (overwrite)
        puts "\n🔄 Syncing templates..."
        puts "  Source: #{gem_templates}"
        puts "  Target: #{global_repo}"
        
        # Remove old repo
        if File.directory?(global_repo)
          FileUtils.rm_rf(global_repo)
          puts "  \e[33m✓ Removed old global repo\e[0m"
        end
        
        # Copy new templates
        FileUtils.cp_r(gem_templates, global_repo)
        puts "  \e[32m✓ Copied new templates\e[0m"
        
        # Reinitialize Git
        puts "\n🔧 Reinitializing git repository..."
        Aura::GlobalConfig.git_run(global_repo, "init")
        Aura::GlobalConfig.git_run(global_repo, "config", "user.name", "Aura CLI")
        Aura::GlobalConfig.git_run(global_repo, "config", "user.email", "support@aura-os.ai")
        Aura::GlobalConfig.git_run(global_repo, "config", "receive.denyCurrentBranch", "updateInstead")
        Aura::GlobalConfig.git_run(global_repo, "checkout", "-b", "main")
        Aura::GlobalConfig.git_run(global_repo, "add", ".")
        Aura::GlobalConfig.git_run(global_repo, "commit", "-m", "Template update from framework v#{Aura::VERSION}")
        
        puts "\n\e[32m✓ Templates synced to global repo!\e[0m"
        puts "\n💡 Next steps:"
        puts "  - Sub-projects can now pull updates via: aura pull"
        puts "  - Or merge with conflict resolution: aura update merge"
        puts "  - Update all projects: aura update all"
      end

      desc "status", "Check template version and sync status"
      def status
        # Find template path from gem installation directory
        lib_aura_path = File.expand_path("../..", __dir__)
        gem_templates = File.join(lib_aura_path, "generators/aura/app/templates")
        
        # Fallback to source path
        unless File.directory?(gem_templates)
          gem_templates = File.expand_path("aura/generators/aura/app/templates", 
                                           File.join(__dir__, "../../../../"))
        end
        
        global_repo = Aura::GlobalConfig.repo_path
        
        puts "📊 Template Sync Status\n"
        puts "=" * 60
        
        # Check framework templates
        puts "Framework Templates:"
        puts "  Path: #{gem_templates}"
        if File.directory?(gem_templates)
          puts "  Status: \e[32mExists\e[0m"
          
          # Count files
          file_count = Dir.glob("**/*", base: gem_templates).count { |f| File.file?(File.join(gem_templates, f)) }
          puts "  Files: #{file_count}"
        else
          puts "  Status: \e[31mNot found\e[0m"
        end
        
        # Check global repo
        puts "\nGlobal Repository (~/.aura/repo):"
        puts "  Path: #{global_repo}"
        if File.directory?(global_repo)
          puts "  Status: \e[32mExists\e[0m"
          
          if File.directory?(File.join(global_repo, ".git"))
            puts "  Git: \e[32mInitialized\e[0m"
            
            # Get last commit
            log_out = Aura::GlobalConfig.git_run(global_repo, "log", "--oneline", "-1")
            if log_out[:success]
              puts "  Last Commit: #{log_out[:stdout].strip}"
            end
            
            # Check if in sync with framework
            puts "\n  ⚠️  Note: To sync framework templates to global repo:"
            puts "     Run: aura template sync"
          else
            puts "  Git: \e[31mNot initialized\e[0m"
          end
        else
          puts "  Status: \e[33mNot found (will be created on first 'aura new')\e[0m"
        end
      end

      desc "diff", "Show differences between framework templates and global repo"
      def diff
        # Find template path from gem installation directory
        lib_aura_path = File.expand_path("../..", __dir__)
        gem_templates = File.join(lib_aura_path, "generators/aura/app/templates")
        
        # Fallback to source path
        unless File.directory?(gem_templates)
          gem_templates = File.expand_path("aura/generators/aura/app/templates", 
                                           File.join(__dir__, "../../../../"))
        end
        
        global_repo = Aura::GlobalConfig.repo_path
        
        unless File.directory?(gem_templates)
          puts "\e[31m⛔️ Framework templates not found!\e[0m"
          exit 1
        end
        
        unless File.directory?(global_repo)
          puts "\e[33m⚠️  Global repo not found. Run 'aura new' first.\e[0m"
          exit 1
        end
        
        puts "🔍 Comparing framework templates vs global repo...\n"
        puts "=" * 60
        
        # Use diff command
        diff_cmd = "diff -rq #{gem_templates.shellescape} #{global_repo.shellescape} || true"
        output = `#{diff_cmd}`
        
        if output.strip.empty?
          puts "\e[32m✓ Framework templates and global repo are in sync!\e[0m"
        else
          puts "\e[33m⚠️  Differences found:\e[0m\n"
          puts output
          puts "\nTo sync, run: aura template sync"
        end
      end
    end
  end
end
