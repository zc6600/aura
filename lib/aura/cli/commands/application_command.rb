# frozen_string_literal: true

require "thor"
require "fileutils"
require "open3"
require "json"
require "yaml"
require "shellwords"

# Load extracted command classes
require "aura/cli/commands/new_command"
require "aura/cli/commands/config_command"
require "aura/cli/commands/doctor_command"
require "aura/cli/commands/info_command"
require "aura/cli/commands/project_command"
require "aura/cli/commands/version_command"
require "aura/cli/commands/completion_command"
require "aura/cli/commands/branch_command"
require "aura/cli/commands/tools_command"
require "aura/cli/commands/kernel_command"
require "aura/cli/commands/shell_command"
require "aura/cli/commands/skills_command"
require "aura/cli/commands/hints_command"
require "aura/cli/commands/session_command"
require "aura/cli/commands/update_command"
require "aura/cli/commands/template_command"
require "aura/cli/shell/web_server"

module Aura
  # Dynamically read version from gemspec if available, otherwise use fallback
  VERSION = begin
    gem_spec = Gem::Specification.find_by_name("aura")
    gem_spec.version.to_s
  rescue Gem::MissingSpecError
    "0.1.0" # Fallback for development from source
  end

  module Commands
    class ApplicationCommand < Thor
      map "h" => "hints"
      map "t" => "tools"
      map "s" => "skill"
      map "k" => "kernel"
      map "c" => "chat"
      map "v" => "version"

      def self.exit_on_failure?
        true
      end

      # Register single commands as subcommands using Thor's built-in register
      register(Aura::Commands::NewCommand, "new", "new [PATH]", "Initialize an Aura environment at the specified path")
      def new(target_path = ".")
        NewCommand.start(["new", target_path].compact)
      end

      register(Aura::Commands::VersionCommand, "version", "version", "Show Aura version")
      def version
        VersionCommand.start(["version"])
      end

      register(Aura::Commands::CompletionCommand, "completion", "completion [SHELL]", "Generate shell autocompletion script (bash or zsh)")
      def completion(shell = nil)
        CompletionCommand.start(["completion", shell].compact)
      end

      register(Aura::Commands::DoctorCommand, "doctor", "doctor", "Run environment checks")

      register(Aura::Commands::InfoCommand, "info", "info", "Display comprehensive system and workspace information")
      def info
        InfoCommand.start(["info"])
      end

      register(Aura::Commands::ConfigCommand, "config", "config [KEY] [VALUE]", "Read or write configuration settings")
      def config(key = nil, value = nil)
        is_global = options && (options[:global] || options["global"])
        ConfigCommand.start(["config", key, value].compact + (is_global ? ["--global"] : []))
      end

      register(Aura::Commands::BranchCommand, "branch", "branch [PROFILE_NAME]", "List, switch, or create customized agent profiles")
      def branch(profile_name = nil)
        BranchCommand.start(["branch", profile_name].compact)
      end

      # Project commands delegate using Thor start pattern
      desc "list", "List all globally registered Aura projects"
      def list
        ProjectCommand.start(["list"])
      end

      desc "delete PROJECT_NAME", "Unregister an Aura project and delete its .aura sandbox"
      def delete(project_name)
        ProjectCommand.start(["delete", project_name])
      end

      desc "register PROJECT_NAME", "Register the current directory as an Aura project"
      def register(project_name)
        ProjectCommand.start(["register", project_name])
      end

      desc "prune", "Remove all registered projects whose directories no longer exist"
      def prune
        ProjectCommand.start(["prune"])
      end

      desc "context [PROJECT_PATH]", "Compile and print project context"
      def context(project_path = nil)
        require "aura/memory"
        resolved_path = Aura::PathResolver.resolve_project_path!(project_path)
        root = File.expand_path(resolved_path)
        env_path = Aura::PathResolver.environment_path(root)
        config = Aura::Memory::Config.new(store: { project_path: env_path })
        memory = Aura::Memory::Base.new(config: config)
        db = Aura::Memory::Adapters::CompatibilityAdapter.new(memory)
        out = Aura::Context.assemble(root, db)
        puts out
      end

      desc "tools SUBCOMMAND ...", "Tools management commands"
      subcommand "tools", Aura::Commands::ToolsCommand

      desc "kernel SUBCOMMAND ...", "Kernel commands"
      subcommand "kernel", Aura::Commands::KernelCommand

      desc "skill SUBCOMMAND ...", "Manage agent skills in the active workspace"
      subcommand "skill", Aura::Commands::SkillsCommand

      desc "hints SUBCOMMAND ...", "Manage context/magic hint injection configurations"
      subcommand "hints", Aura::Commands::HintsCommand

      desc "session SUBCOMMAND ...", "Manage conversation sessions"
      subcommand "session", Aura::Commands::SessionCommand

      desc "update SUBCOMMAND ...", "Update framework, templates, and sub-projects"
      subcommand "update", Aura::Commands::UpdateCommand

      desc "template SUBCOMMAND ...", "Template management and sync"
      subcommand "template", Aura::Commands::TemplateCommand

      desc "chat [PROJECT_PATH]", "Start an interactive Aura chat session"
      method_option :verbose, type: :boolean, aliases: "-v", desc: "Show detailed output"
      method_option :goal, type: :string, aliases: "-g", desc: "Autonomous goal to execute without interactive input (exits when complete)"
      method_option :non_interactive, type: :boolean, aliases: "--ni", default: false,
                                      desc: "Run non-interactively (requires --goal); final answer is printed to stdout"
      method_option :mode, type: :string, default: "classic", desc: "Run loop mode: classic or ralph",
                           validate: lambda { |mode|
                             %w[classic ralph].include?(mode.to_s.downcase) || (puts "\e[31m⛔️ Error: Mode must be 'classic' or 'ralph'\e[0m"
                                                                                exit 1)
                           }
      method_option :verify, type: :string, desc: "Verify test command for Ralph Loop"
      method_option :critic, type: :boolean, default: false, desc: "Use Critic LLM instead of test command for Ralph Loop"
      method_option :max_steps, type: :numeric, desc: "Maximum steps/calls in Ralph Loop"
      def chat(project_path = nil)
        resolved_path = Aura::PathResolver.resolve_project_path!(project_path)

        # Validate max_steps if provided
        if options[:max_steps] || options["max_steps"]
          max_steps = options[:max_steps] || options["max_steps"]
          options[:max_steps] = Aura::PathResolver.validate_max_steps(max_steps)
        end

        Aura::Commands::ShellCommand.new.start(resolved_path, options)
      end

      desc "web [PROJECT_PATH]", "Start a lightweight Aura web server (events JSON & SSE)"
      method_option :port, type: :numeric, aliases: "-p", default: 9299, desc: "Port to bind",
                           validate: lambda { |p|
                             (p.to_i >= 0 && p.to_i <= 65_535) || (puts "\e[31m⛔️ Error: Port must be between 0 and 65535\e[0m"
                                                                   exit 1)
                           }
      method_option :host, type: :string, aliases: "-h", default: "127.0.0.1", desc: "Host address"
      def web(project_path = nil)
        resolved_path = Aura::PathResolver.resolve_project_path!(project_path)
        port = Aura::PathResolver.validate_port(options[:port] || options["port"] || 9299)
        host = (options[:host] || options["host"] || "127.0.0.1").to_s

        server = Aura::CLI::Shell::WebServer.new(resolved_path, port: port, host: host)
        server.start
      end

      # --- Git-based Version Control Commands ---

      desc "add PATHS...", "Stage files inside the local Aura environment"
      def add(*paths)
        aura_dir = ensure_workspace!

        require "pathname"
        resolved_paths = paths.map do |p|
          abs_p = File.expand_path(p)
          if abs_p.start_with?(aura_dir)
            Pathname.new(abs_p).relative_path_from(Pathname.new(aura_dir)).to_s
          else
            p
          end
        end

        res = Aura::GlobalConfig.git_run(aura_dir, "add", *resolved_paths)
        if res[:success]
          puts "\e[32mSuccessfully staged changes inside .aura.\e[0m"
        else
          puts "\e[31mError staging changes:\n#{res[:stderr]}\e[0m"
        end
      end

      desc "commit", "Commit staged changes inside the local Aura environment"
      method_option :message, type: :string, aliases: "-m", required: true, desc: "Commit message"
      def commit
        aura_dir = ensure_workspace!
        msg = options[:message] || options["message"]
        res = Aura::GlobalConfig.git_run(aura_dir, "commit", "-m", msg.to_s)
        if res[:success]
          puts "\e[32mSuccessfully committed changes inside .aura:\e[0m"
          puts res[:stdout]
        else
          puts "\e[31mError committing changes:\n#{res[:stderr]}\e[0m"
        end
      end

      desc "sync", "Push local workspace changes back to the global template repository"
      def sync
        aura_dir = ensure_workspace!
        puts "Syncing changes back to the global repository (~/.aura/repo)..."
        res = Aura::GlobalConfig.git_run(aura_dir, "push", "origin", "main")
        if res[:success]
          puts "\e[32mSuccessfully synced local changes to global repo!\e[0m"
        else
          puts "\e[31mError syncing changes:\n#{res[:stderr]}\e[0m"
        end
      end

      desc "pull", "Pull new templates or updates from the global repository"
      def pull
        aura_dir = ensure_workspace!
        puts "Pulling updates from the global repository (~/.aura/repo)..."
        res = Aura::GlobalConfig.git_run(aura_dir, "pull", "origin", "main")
        if res[:success]
          puts "\e[32mSuccessfully pulled updates from global repo!\e[0m"
          puts res[:stdout]
        else
          puts "\e[31mError pulling updates:\n#{res[:stderr]}\e[0m"
        end
      end

      desc "status", "Show what files are modified or untracked inside .aura"
      def status
        aura_dir = ensure_workspace!
        res = Aura::GlobalConfig.git_run(aura_dir, "status")
        puts res[:stdout]
        puts res[:stderr] unless res[:stderr].empty?
      end

      desc "ask QUESTION", "Directly ask the LLM a question without any Aura OS context wrapping (retains conversation memory)"
      method_option :model, type: :string, desc: "Override model name"
      method_option :provider, type: :string, desc: "Override provider name (local, openai, openrouter)"
      method_option :system, type: :string, desc: "System prompt instructions"
      method_option :session, type: :string, aliases: "-s", default: "default", desc: "Session name for memory"
      method_option :clear, type: :boolean, aliases: "-c", default: false, desc: "Clear session memory before asking"
      def ask(question)
        require "aura/llm/client"
        require "aura/llm/env"

        # Load configuration (checking active .aura workspace config first, then global config)
        aura_dir = find_aura_dir
        cfg_path = Aura::PathResolver.resolve_config_path(aura_dir || Aura::GlobalConfig.repo_path)

        cfg = File.exist?(cfg_path) ? (YAML.load_file(cfg_path) || {}) : {}

        # Determine provider, api_base, model, temperature
        provider = options[:provider] || options["provider"] || cfg.dig("llm", "provider") || "local"
        api_base = cfg.dig("llm", "api_base")
        model = options[:model] || options["model"] || cfg.dig("llm", "model")
        temp = cfg.dig("llm", "temperature") || 0.7
        max_tokens = cfg.dig("llm", "max_tokens")

        # Load API keys: workspace .env first, then global sources (~/.aura/repo/.env, ~/.aura/.env)
        if aura_dir
          Aura::LLM::Env.load_from(File.dirname(aura_dir))
        else
          # Not inside a workspace: load cwd .env then global fallbacks
          Aura::LLM::Env.load_from(Dir.pwd)
        end
        api_key = Aura::LLM::Env.resolve_api_key(provider)

        # Resolve history session file
        state_dir = if aura_dir
                      File.join(aura_dir, "state")
                    else
                      File.join(Aura::GlobalConfig.repo_path, "state")
                    end
        sessions_dir = File.join(state_dir, "ask_sessions")
        session_name = options[:session] || options["session"] || "default"
        # Sanitize session name to prevent directory traversal
        begin
          session_name = Aura::PathResolver.sanitize_session_name(session_name)
        rescue ArgumentError => e
          puts "\e[31m⛔️ Error: Invalid session name: #{e.message}\e[0m"
          exit 1
        end
        history_file = File.join(sessions_dir, "#{session_name}.json")

        if options[:clear] || options["clear"]
          FileUtils.rm_f(history_file)
          puts "\e[33mMemory cleared for session '#{session_name}'.\e[0m"
        end

        history = []
        if File.exist?(history_file)
          begin
            history = JSON.parse(File.read(history_file))
          rescue StandardError
            # If invalid JSON, default to empty history
          end
        end

        llm_cfg = (cfg["llm"] || {}).dup
        llm_cfg["provider"] = options[:provider] || options["provider"] if options[:provider] || options["provider"]
        llm_cfg["model"] = options[:model] || options["model"] if options[:model] || options["model"]
        project_path = aura_dir ? File.dirname(aura_dir) : Dir.pwd

        client = if defined?(Aura::LLM::Client) && Aura::LLM::Client.respond_to?(:from_config)
                   Aura::LLM::Client.from_config(llm_cfg, project_path)
                 else
                   Aura::LLM::Client.new(provider: provider, api_base: api_base, api_key: api_key, model: model)
                 end

        messages = []
        system_instruction = options[:system] || options["system"]

        # Append sliding window of last 10 messages (5 turns)
        limit = 10
        recent_history = history.last(limit)
        recent_history.each do |msg|
          role = msg["role"] || msg[:role]
          content = msg["content"] || msg[:content]
          messages << { role: role.to_s, content: content.to_s }
        end

        q_content = if system_instruction
                      "System Instruction: #{system_instruction}\n\n#{question}"
                    else
                      question
                    end
        messages << { role: "user", content: q_content }

        puts "\e[34m🤖 Connecting to #{provider} (#{model || 'default model'})...\e[0m"
        puts ""

        # Stream response
        response_text = +""
        begin
          client.complete_stream(messages, { temperature: temp, max_tokens: max_tokens }) do |delta|
            print delta
            response_text << delta
            $stdout.flush
          end
          puts ""

          # Save back to history if successfully completed and response is not empty
          unless response_text.strip.empty?
            history << { role: "user", content: question }
            history << { role: "assistant", content: response_text }
            # Limit history to 100 messages (50 turns) to prevent file bloat
            history = history.last(100)

            begin
              FileUtils.mkdir_p(sessions_dir)
              File.write(history_file, JSON.pretty_generate(history))
            rescue StandardError => e
              puts "\e[33m⚠️ Warning: Failed to save session history: #{e.message}\e[0m"
            end
          end
        rescue StandardError => e
          puts "\n\e[31m⛔️ Error calling LLM: #{e.message}\e[0m"
        end
      end

      private

      def find_aura_dir
        Aura.find_aura_dir(Dir.pwd)
      end

      def ensure_workspace!
        Aura::PathResolver.ensure_workspace!(Dir.pwd)
      end
    end
  end
end
