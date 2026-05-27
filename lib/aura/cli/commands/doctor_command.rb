# frozen_string_literal: true

require "thor"
require "open3"

module Aura
  module Commands
    class DoctorCommand < Thor
      default_task :doctor

      def self.exit_on_failure?
        true
      end

      desc "doctor", "Run environment checks"
      method_option :prompts, type: :boolean, aliases: "-p", desc: "Validate prompt templates and synchronization"
      def doctor
        if options[:prompts]
          load_dotenv_files
          check_prompts
          return
        end

        ruby_ver = RUBY_VERSION
        puts "Ruby: #{ruby_ver}"

        # Check Git
        git_ver, _err, status = Open3.capture3("git", "--version")
        if status.success?
          puts "Git: #{git_ver.strip}"
        else
          puts "\e[31mGit: Not found!\e[0m"
          puts "💡 To install Git:"
          puts "   - macOS: brew install git"
          puts "   - Ubuntu/Debian: sudo apt-get install git"
        end

        # Check Docker
        docker_ver, _err, docker_status = Open3.capture3("docker", "--version")
        if docker_status.success?
          puts "Docker: #{docker_ver.strip}"

          # Check if Docker daemon is running
          _, _err, info_status = Open3.capture3("docker", "info", "--format", "{{.ServerVersion}}")
          if info_status.success?
            puts "Docker Daemon: \e[32mRunning\e[0m"

            # Check if buildx is available
            buildx_out, _err, buildx_status = Open3.capture3("docker", "buildx", "version")
            if buildx_status.success?
              puts "Docker Buildx: #{buildx_out.strip}"
            else
              puts "\e[33m⚠️ Docker Buildx: Not available (optional but recommended)\e[0m"
            end

            # Check if sandbox image exists
            sandbox_image = "aura-sandbox"
            images_out, _err, images_status = Open3.capture3("docker", "images", "--format", "{{.Repository}}:{{.Tag}}", sandbox_image)
            if images_status.success? && !images_out.strip.empty?
              puts "Sandbox Image: \e[32m#{sandbox_image} found\e[0m"
            else
              puts "\e[33m⚠️ Sandbox Image: '#{sandbox_image}' not found (run 'aura sandbox build' to create)\e[0m"
            end
          else
            puts "\e[31mDocker Daemon: Not running\e[0m"
            puts "💡 Start Docker Desktop or run: sudo systemctl start docker"
          end
        else
          puts "\e[31mDocker: Not found!\e[0m"
          puts "💡 To install Docker:"
          puts "   - macOS: brew install --cask docker"
          puts "   - Ubuntu/Debian: Follow https://docs.docker.com/engine/install/"
        end

        # Check SQLite3
        sqlite_out, _err, sqlite_status = Open3.capture3("sqlite3", "--version")
        if sqlite_status.success?
          sqlite_ver = sqlite_out.strip.split.first
          puts "SQLite3: #{sqlite_ver}"
        else
          puts "\e[33m⚠️ SQLite3: CLI not found (Ruby gem may still work)\e[0m"
        end

        # Check Global Repo
        begin
          Aura.ensure_global_repo!
          puts "Global Repository (~/.aura/repo): OK"
        rescue StandardError => e
          puts "\e[31mGlobal Repository: Failed to initialize! (#{e.message})\e[0m"
        end

        # Check LLM Configurations
        # Load .env files so keys saved there are recognized without requiring a shell export
        load_dotenv_files

        workspace_path = find_aura_dir
        cfg_path = Aura::PathResolver.resolve_config_path(workspace_path || Aura::GlobalConfig.repo_path)

        provider = nil
        api_key_set = false
        env_var_name = nil

        if File.exist?(cfg_path)
          begin
            require "yaml"
            cfg = YAML.load_file(cfg_path) || {}
            llm_cfg = cfg["llm"] || {}
            provider = llm_cfg["provider"]
            if provider && !provider.to_s.strip.empty?
              env_var_name = case provider.to_s.downcase
                             when "openai" then "OPENAI_API_KEY"
                             when "openrouter" then "OPENROUTER_API_KEY"
                             when "anthropic" then "ANTHROPIC_API_KEY"
                             when "gemini" then "GEMINI_API_KEY"
                             when "deepseek" then "DEEPSEEK_API_KEY"
                             end
              api_key_set = (env_var_name && ENV.fetch(env_var_name, nil) && !ENV[env_var_name].empty?) ||
                            (llm_cfg["api_key"] && !llm_cfg["api_key"].to_s.strip.empty?)
            end
          rescue StandardError
          end
        end

        if provider.nil? || provider.to_s.strip.empty?
          puts "\e[33m⚠️ LLM Provider: Not configured\e[0m"
          puts "💡 To configure your LLM provider, run:"
          puts "   $ aura config llm.provider <provider>  (e.g., openai, openrouter, anthropic, gemini)"
        elsif !api_key_set
          puts "\e[33m⚠️ LLM API Key: Missing for provider '#{provider}'\e[0m"
          puts "💡 To set the API key in config, run:"
          puts "   $ aura config llm.api_key <your_api_key>"
          if env_var_name
            puts "💡 Or export the environment variable in your terminal:"
            puts "   $ export #{env_var_name}=<your_api_key>"
          end
        else
          puts "LLM Config (Provider: #{provider}): OK"
        end

        puts "Aura CLI: OK"

        puts "\nChecking prompt templates..."
        check_prompts
      end

      private

      def check_prompts
        workspace_path = find_aura_dir ? File.dirname(find_aura_dir) : Dir.pwd
        puts "Workspace Root: #{workspace_path}"

        require "aura/llm/prompts/registry"

        # Validate standard prompt
        puts "\n[Standard Mode Prompt]"
        standard_prompt = Aura::LLM::Prompts::Registry.resolve(:standard, workspace_path)
        validate_and_print_prompt(:standard, standard_prompt)

        # Validate Ralph developer prompt
        puts "\n[Ralph Developer Prompt]"
        ralph_dev_prompt = Aura::LLM::Prompts::Registry.resolve(:ralph_developer, workspace_path)
        validate_and_print_prompt(:ralph_developer, ralph_dev_prompt)

        # Validate Ralph critic prompt
        puts "\n[Ralph Critic Prompt]"
        ralph_critic_prompt = Aura::LLM::Prompts::Registry.resolve(:ralph_critic, workspace_path)
        validate_and_print_prompt(:ralph_critic, ralph_critic_prompt)

        # Sync checks: compare overrides with system defaults
        check_overrides_sync(workspace_path)
      end

      def validate_and_print_prompt(_mode, prompt)
        char_count = prompt.length
        puts "  Compiled Length: #{char_count} chars (~#{(char_count / 4.0).round} tokens)"

        if char_count > 100_000
          puts "  \e[31m❌ Warning: Prompt length exceeds 100k characters. This may cause large latency or API costs.\e[0m"
        elsif char_count > 20_000
          puts "  \e[33m⚠️ Warning: Prompt length is large (#{char_count} chars). Check if all sections are necessary.\e[0m"
        else
          puts "  Length constraint: \e[32mOK\e[0m"
        end

        issues = Aura::LLM::Prompts::Registry.validate_prompt(prompt)
        if issues.any?
          issues.each { |iss| puts "  \e[33m⚠️ #{iss}\e[0m" }
        else
          puts "  Structure validation: \e[32mOK\e[0m"
        end
      end

      def check_overrides_sync(workspace_path)
        # Check standard legacy skills/system.md
        legacy = File.join(workspace_path, "skills", "system.md")
        if File.exist?(legacy)
          puts "\n[Workspace Prompt Sync]"
          puts "  Found legacy system override at skills/system.md."
          puts "  💡 Note: Modular prompt section overrides (prompts/system/*.md) will be ignored because skills/system.md takes precedence."
        end

        # Check for any modular overrides
        override_dir = File.join(workspace_path, "prompts", "system")
        return unless File.directory?(override_dir)

        puts "\n[Workspace Prompt Sync]"
        Dir.glob(File.join(override_dir, "*.md")).each do |override_file|
          basename = File.basename(override_file)
          puts "  Found modular override: prompts/system/#{basename}"

          # Compare with system default if exists
          default_path = File.expand_path("../../llm/prompts/system/#{basename}", __dir__)
          next unless File.exist?(default_path)

          default_content = File.read(default_path, encoding: "utf-8")
          override_content = File.read(override_file, encoding: "utf-8")

          if default_content.strip == override_content.strip
            puts "    \e[33m⚠️ Identical to system default. Consider removing this override to receive future framework updates.\e[0m"
          end
        end
      end

      def find_aura_dir
        Aura::PathResolver.find_aura_dir(Dir.pwd)
      end

      # Manually parse and load .env files into ENV so that keys stored there
      # are visible to the doctor check even without a shell-level export.
      # Priority order (later values win): global ~/.aura/.env, then workspace .env
      def load_dotenv_files
        candidates = [
          File.join(Dir.home, ".aura", ".env"),
          File.join(Dir.pwd, ".env")
        ]

        # Also try the workspace root (two levels up from .aura if inside one)
        aura_dir = find_aura_dir
        if aura_dir
          workspace_root = File.dirname(aura_dir)
          candidates << File.join(workspace_root, ".env")
        end

        candidates.uniq.each do |env_file|
          next unless File.exist?(env_file)

          File.foreach(env_file) do |line|
            line = line.strip
            next if line.empty? || line.start_with?("#")

            key, value = line.split("=", 2)
            next unless key && value

            key   = key.strip
            value = value.strip.gsub(/\A["']|["']\z/, "") # strip surrounding quotes
            ENV[key] ||= value # don't overwrite already-set vars
          end
        rescue StandardError
          # silently skip unreadable .env files
        end
      end
    end
  end
end
