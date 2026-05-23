# frozen_string_literal: true

require "readline"
require "json"
require "yaml"
require "aura/kernel"
require "aura/llm/client"
require "aura/cli/commands/dashboard"
require "aura/cli/shell/executor"
require "aura/cli/shell/slash_command_manager"
require "aura/context/session_manager"
require "aura/config_loader"

module Aura
  module CLI
    module Shell
      class Session
        def initialize(project_path, options = {})
          @project_path = File.expand_path(project_path)
          @options = options
          @auto = true
        end

        def start
          setup_environment
          goal = @options[:goal] || @options["goal"]
          show_dashboard if goal.nil? || goal.to_s.strip.empty?
          run_loop
        end

        private

        def setup_environment
          @runner = Aura::Kernel::Runner.new(@project_path)
          @config = load_config
          
          # Load environment variables from .env file
          require "aura/llm/env"
          Aura::LLM::Env.load_from(@project_path)
          
          # Initialize session management
          @session_mgr = Aura::Context::SessionManager.new(@project_path)
          current_session = @session_mgr.current_name
          if current_session
            puts "\e[33m📝 Session: #{current_session}\e[0m" if @options[:verbose]
          end
          
          if @options[:verbose]
            @config["verbose"] = true 
            puts "Verbose mode: ON" if @config["verbose"] || ENV["VERBOSE"] == "true"
          end

          # Initialize LLM client with automatic defaults
          llm_config = @config["llm"] || {}
          
          # Apply default provider if not configured
          provider = llm_config["provider"]
          if provider.nil? || provider.to_s.strip.empty? || provider == "local"
            # Auto-detect from available API keys
            if ENV["OPENROUTER_API_KEY"] && !ENV["OPENROUTER_API_KEY"].empty?
              provider = "openrouter"
              puts "\e[32mℹ️ Auto-configured LLM provider: openrouter (from OPENROUTER_API_KEY)\e[0m"
            elsif ENV["OPENAI_API_KEY"] && !ENV["OPENAI_API_KEY"].empty?
              provider = "openai"
              puts "\e[32mℹ️ Auto-configured LLM provider: openai (from OPENAI_API_KEY)\e[0m"
            elsif ENV["ANTHROPIC_API_KEY"] && !ENV["ANTHROPIC_API_KEY"].empty?
              provider = "anthropic"
              puts "\e[32mℹ️ Auto-configured LLM provider: anthropic (from ANTHROPIC_API_KEY)\e[0m"
            else
              provider = "local"
            end
          end
          
          # Apply default model if not configured
          model = llm_config["model"]
          if model.nil? || model.to_s.strip.empty?
            case provider
            when "openrouter"
              model = "openai/gpt-4o"
            when "openai"
              model = "gpt-4o"
            when "anthropic"
              model = "claude-sonnet-4-20250514"
            else
              model = nil
            end
            puts "\e[32mℹ️ Using default model: #{model}\e[0m" if model && @options[:verbose]
          end
          
          # Update config with resolved values
          llm_config["provider"] = provider
          llm_config["model"] = model if model
          
          @client = Aura::LLM::Client.new(
            provider: provider,
            api_base: llm_config["api_base"],
            api_key: resolve_api_key(llm_config),
            model: model
          )

          @slash_manager = SlashCommandManager.new(@project_path, -> { load_config }, @runner, on_reload: -> { setup_environment })
          @executor = Executor.new(@project_path, @runner, -> { load_config })
        end

        def show_dashboard
          Aura::Commands::Dashboard.new(@project_path, @config).render
        end

        def run_loop
          goal = @options[:goal] || @options["goal"]
          if goal && !goal.to_s.strip.empty?
            # Non-interactive autonomous mode
            summary = @executor.process_goal(goal.to_s.strip)
            $stdout.puts summary if summary && !summary.strip.empty?
            return
          end

          puts "Welcome to Aura Shell. Type /help for commands."
          
          loop do
            begin
              line = Readline.readline("aura> ", true)
            rescue Interrupt
              puts "\n(Interrupted by user)"
              next
            rescue StandardError => e
              # If we get an IO error repeatedly (e.g. closed stream), we should probably exit
              puts "\n(Input error: #{e.message})"
              break
            end

            if line.nil?
              puts "\n(EOF)"
              break
            end

            input = line.strip
            
            # Basic multiline support with backslash
            if input.end_with?("\\")
              buffer = [input.sub(/\\$/, "")]
              loop do
                print "....> "
                cont = $stdin.gets
                break if cont.nil?
                cont_strip = cont.strip
                if cont_strip.end_with?("\\")
                  buffer << cont_strip.sub(/\\$/, "")
                else
                  buffer << cont_strip
                  break
                end
              end
              input = buffer.join("\n")
            end

            break if %w[exit quit].include?(input.downcase)
            
            if @slash_manager.handle(input)
              next
            end

            if input.downcase == "auto on"
              @auto = true
              puts "Auto mode: ON"
              next
            elsif input.downcase == "auto off"
              @auto = false
              puts "Auto mode: OFF (Interactive Mode)"
              next
            end
            
            next if input.empty?
            
            @executor.process(input, @auto)
          end
        end

        def load_config
          Aura::ConfigLoader.load(@project_path)
        end

        def resolve_api_key(config)
          # 0. Check explicit api_key in config
          return config["api_key"] if config["api_key"]

          # 1. Check explicit environment variable name in config
          if (env_var = config["api_key_env"])
            return ENV[env_var] if ENV[env_var]
          end

          # 2. Use Aura::LLM::Env.resolve_api_key which handles .env loading
          provider = config["provider"].to_s
          unless provider.empty?
            key = Aura::LLM::Env.resolve_api_key(provider)
            return key if key && !key.empty?
          end

          # 3. Dynamic key from provider: {PROVIDER}_API_KEY
          unless provider.empty?
            key_name = "#{provider.upcase}_API_KEY"
            return ENV[key_name] if ENV[key_name]
          end

          # 4. Fallback for backward compatibility
          ENV["OPENROUTER_API_KEY"] || ENV["OPENAI_API_KEY"]
        end
      end
    end
  end
end