# frozen_string_literal: true

require "readline"
require "json"
require "yaml"
require "aura/kernel"
require "aura/llm/client"
require "aura/cli/commands/dashboard"
require "aura/cli/shell/executor"
require "aura/cli/shell/slash_command_manager"

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
          
          if @options[:verbose]
            @config["verbose"] = true 
            puts "Verbose mode: ON" if @config["verbose"] || ENV["VERBOSE"] == "true"
          end

          # Initialize LLM client
          llm_config = @config["llm"] || {}
          @client = Aura::LLM::Client.new(
            provider: llm_config["provider"],
            api_base: llm_config["api_base"],
            api_key: resolve_api_key(llm_config),
            model: llm_config["model"]
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
          path = File.join(@project_path, "config", "config.yml")
          File.exist?(path) ? YAML.load_file(path) : {}
        rescue StandardError
          {}
        end

        def resolve_api_key(config)
          # 0. Check explicit api_key in config
          return config["api_key"] if config["api_key"]

          # 1. Check explicit environment variable name in config
          if (env_var = config["api_key_env"])
            return ENV[env_var] if ENV[env_var]
          end

          # 2. Dynamic key from provider: {PROVIDER}_API_KEY
          provider = config["provider"].to_s
          unless provider.empty?
            key_name = "#{provider.upcase}_API_KEY"
            return ENV[key_name] if ENV[key_name]
          end

          # 3. Fallback for backward compatibility
          ENV["OPENROUTER_API_KEY"] || ENV["OPENAI_API_KEY"]
        end
      end
    end
  end
end
