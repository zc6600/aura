# frozen_string_literal: true

require "thor"
require "open3"
require "yaml"

module Aura
  module Commands
    class InfoCommand < Thor
      def self.exit_on_failure?
        true
      end

      desc "info", "Display comprehensive system and workspace information"
      def info
        display_system_info
        display_workspace_info
      end

      private

      def display_system_info
        puts "=" * 70
        puts "\e[1;34m🌟 Aura OS - System Information\e[0m"
        puts "=" * 70
        
        puts "\n\e[1m📦 System:\e[0m"
        puts "  OS: #{RbConfig::CONFIG['host_os']}"
        puts "  Ruby: #{RUBY_VERSION} (#{RUBY_PLATFORM})"
        puts "  Architecture: #{RbConfig::CONFIG['arch']}"
        
        puts "\n\e[1m🎯 Aura Framework:\e[0m"
        puts "  Version: #{Aura::VERSION}"
        puts "  CLI Path: #{File.expand_path(__dir__)}"
        
        display_global_environment
        display_global_llm_config
        display_docker_status
        display_registered_projects
      end

      def display_global_environment
        global_path = Aura::GlobalConfig.repo_path
        puts "\n\e[1m📁 Global Environment:\e[0m"
        puts "  Global Repository: #{global_path}"
        puts "  Global Config: #{File.join(global_path, 'config', 'config.yml')}"
        puts "  Global Database: #{File.join(global_path, 'state', 'aura.db')}"
      end

      def display_global_llm_config
        global_cfg_path = File.join(Aura::GlobalConfig.repo_path, "config", "config.yml")
        return unless File.exist?(global_cfg_path)
        
        require "yaml"
        global_cfg = YAML.load_file(global_cfg_path) || {}
        global_llm_cfg = global_cfg["llm"] || {}
        provider = global_llm_cfg["provider"] || "Not configured"
        model = global_llm_cfg["model"] || "Default"
        api_base = global_llm_cfg["api_base"] || "Default"
        
        puts "\n\e[1m🤖 Global LLM Configuration:\e[0m"
        puts "  Provider: #{provider}"
        puts "  Model: #{model}"
        puts "  API Base: #{api_base}"
        
        env_var_name = case provider.to_s.downcase
                       when "openai" then "OPENAI_API_KEY"
                       when "openrouter" then "OPENROUTER_API_KEY"
                       when "anthropic" then "ANTHROPIC_API_KEY"
                       when "gemini" then "GEMINI_API_KEY"
                       when "deepseek" then "DEEPSEEK_API_KEY"
                       else nil
                       end
        api_key_status = if env_var_name && ENV[env_var_name] && !ENV[env_var_name].empty?
                           "\e[32mSet (via environment)\e[0m"
                         elsif global_llm_cfg["api_key"] && !global_llm_cfg["api_key"].to_s.strip.empty?
                           "\e[32mSet (via config)\e[0m"
                         else
                           "\e[31mNot set\e[0m"
                         end
        puts "  API Key: #{api_key_status}"
      end

      def display_docker_status
        puts "\n\e[1m🐳 Docker Environment:\e[0m"
        docker_ver, _err, docker_status = Open3.capture3("docker", "--version")
        if docker_status.success?
          puts "  Docker: #{docker_ver.strip}"
          docker_info_out, _err, info_status = Open3.capture3("docker", "info", "--format", "{{.ServerVersion}}")
          if info_status.success?
            puts "  Daemon: \e[32mRunning\e[0m"
            containers_out, _err, _ = Open3.capture3("docker", "ps", "-a", "--format", "{{.Names}}")
            container_count = containers_out.strip.empty? ? 0 : containers_out.strip.split("\n").size
            puts "  Containers: #{container_count} total"
          else
            puts "  Daemon: \e[31mNot running\e[0m"
          end
        else
          puts "  Docker: \e[31mNot installed\e[0m"
        end
      end

      def display_registered_projects
        puts "\n\e[1m📋 Registered Projects:\e[0m"
        projects_path = File.join(Aura::GlobalConfig.repo_path, "projects")
        if File.directory?(projects_path)
          projects = Dir.entries(projects_path).reject { |e| e.start_with?(".") }
          if projects.any?
            projects.each do |project|
              project_path = File.join(projects_path, project)
              puts "  - #{project}"
              puts "    Path: #{project_path}" if File.directory?(project_path)
            end
          else
            puts "  No projects registered"
          end
        end
      end

      def display_workspace_info
        workspace_path = find_aura_dir
        
        unless workspace_path
          puts "\n" + "=" * 70
          puts "\e[1;33m⚠️  No Workspace Detected\e[0m"
          puts "=" * 70
          puts "\n  Not currently in an Aura workspace (no .aura directory found)."
          puts "  To create a workspace, run: \e[1maura new <project_name>\e[0m"
          puts "\n" + "=" * 70
          return
        end

        puts "\n" + "=" * 70
        puts "\e[1;32m📂 Workspace Information (Current Project)\e[0m"
        puts "=" * 70
        
        puts "\n\e[1m📍 Workspace:\e[0m"
        puts "  Workspace Root: #{File.dirname(workspace_path)}"
        puts "  .aura Path: #{workspace_path}"
        
        display_workspace_config(workspace_path)
        display_workspace_database(workspace_path)
        display_workspace_skills(workspace_path)
        display_workspace_tools(workspace_path)
        display_sandbox_config(workspace_path)
        display_git_branch(workspace_path)
        
        puts "\n" + "=" * 70
      end

      def display_workspace_config(workspace_path)
        workspace_cfg_path = File.join(workspace_path, "config", "config.yml")
        unless File.exist?(workspace_cfg_path)
          puts "\n\e[1m⚙️ Workspace Configuration:\e[0m"
          puts "  No workspace-specific config (using global defaults)"
          return
        end
        
        require "yaml" unless defined?(YAML)
        workspace_cfg = YAML.load_file(workspace_cfg_path) || {}
        workspace_llm_cfg = workspace_cfg["llm"] || {}
        
        puts "\n\e[1m⚙️ Workspace Configuration:\e[0m"
        
        if workspace_llm_cfg["provider"]
          puts "  LLM Provider: \e[33m#{workspace_llm_cfg['provider']} (workspace override)\e[0m"
          puts "  LLM Model: #{workspace_llm_cfg['model'] || 'Inherit from global'}"
          puts "  ⚠️  Note: Workspace config overrides global LLM settings"
        else
          puts "  LLM Provider: \e[32mInherit from global\e[0m"
          puts "  LLM Model: \e[32mInherit from global\e[0m"
        end
      end

      def display_workspace_database(workspace_path)
        workspace_db_path = File.join(workspace_path, "state", "aura.db")
        puts "\n\e[1m💾 Workspace Database:\e[0m"
        unless File.exist?(workspace_db_path)
          puts "  Not yet initialized"
          return
        end
        
        db_size = File.size(workspace_db_path)
        puts "  Path: #{workspace_db_path}"
        puts "  Size: #{db_size > 1024 ? "#{(db_size / 1024.0).round(1)} KB" : "#{db_size} B"}"
      end

      def display_workspace_skills(workspace_path)
        workspace_skills_path = File.join(workspace_path, "skills")
        return unless File.directory?(workspace_skills_path)
        
        workspace_skills = Dir.entries(workspace_skills_path).reject { |e| e.start_with?(".") }
        puts "\n\e[1m🎨 Workspace Skills:\e[0m"
        puts "  #{workspace_skills.size} skills installed"
        puts "  Skills: #{workspace_skills.join(', ')}" if workspace_skills.any?
      end

      def display_workspace_tools(workspace_path)
        workspace_tools_path = File.join(workspace_path, "tools")
        return unless File.directory?(workspace_tools_path)
        
        workspace_tools = Dir.entries(workspace_tools_path).reject { |e| e.start_with?(".") }
        puts "\n\e[1m🔧 Workspace Tools:\e[0m"
        puts "  #{workspace_tools.size} tools configured"
      end

      def display_sandbox_config(workspace_path)
        sandbox_dockerfile = File.join(workspace_path, "Dockerfile.sandbox")
        sandbox_wrapper = File.join(workspace_path, "sandbox-wrapper.sh")
        puts "\n\e[1m🐳 Sandbox Configuration:\e[0m"
        puts "  Dockerfile.sandbox: #{File.exist?(sandbox_dockerfile) ? '\e[32mExists\e[0m' : '\e[31mNot found\e[0m'}"
        puts "  Sandbox Wrapper: #{File.exist?(sandbox_wrapper) ? '\e[32mExists\e[0m' : '\e[33mNot found\e[0m'}"
      end

      def display_git_branch(workspace_path)
        git_branch, _err, git_status = Open3.capture3("git", "branch", "--show-current", chdir: workspace_path)
        return unless git_status.success?
        
        branch = git_branch.strip
        puts "\n\e[1m🌿 Agent Profile:\e[0m"
        puts "  Git Branch: #{branch.empty? ? 'HEAD detached' : branch}"
      end

      def find_aura_dir
        Aura::PathResolver.find_aura_dir(Dir.pwd)
      end
    end
  end
end
