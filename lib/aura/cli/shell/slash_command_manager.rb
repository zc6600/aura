# frozen_string_literal: true

require "yaml"
require "fileutils"
require "aura/memory/session_manager"

module Aura
  module CLI
    module Shell
      class SlashCommandManager
        def initialize(project_path, config_loader, runner, on_reload: nil)
          @project_path = project_path
          @config_loader = config_loader
          @runner = runner
          @on_reload = on_reload
        end

        def handle(input)
          return false unless input.start_with?("/")

          parts = input.strip.split(/\s+/, 2)
          cmd = parts[0].downcase
          args = parts[1]

          case cmd
          when "/model"
            handle_model(args)
          when "/help"
            handle_help
          when "/undo"
            handle_undo
          when "/redo"
            handle_redo
          when "/session"
            handle_session(args)
          else
            puts "Unknown command: #{cmd}"
          end
          true
        end

        private

        def handle_session(args)
          session_mgr = Aura::Memory::SessionManager.new(@project_path)

          if args.nil? || args.empty? || args.strip.downcase == "list"
            sessions = session_mgr.list
            current = session_mgr.current_name

            puts "Aura Conversation Sessions:"
            puts "-" * 60

            if sessions.empty?
              puts "  No sessions found."
              puts "  Create one: aura session create <name>"
            else
              sessions.each do |s|
                active_star = s[:name] == current ? "* " : "  "
                events = s[:event_count] || 0
                puts "#{active_star}#{s[:name].to_s.ljust(30)} (#{events} events)"
              end
            end

            puts "-" * 60
            puts "Usage: /session <session_name>  - Switch session"
            puts "       /session new             - Start a new timestamped session"
          else
            name = args.strip
            if name.downcase == "new"
              name = "session_#{Time.now.strftime('%Y%m%d_%H%M%S')}"

              # Create the session if it doesn't exist
              session_mgr.create(name) unless session_mgr.exists?(name)
            end

            unless session_mgr.exists?(name)
              puts "\e[31m⛔️ Session '#{name}' does not exist\e[0m"
              puts "Create it first: /session new"
              return
            end

            session_mgr.activate(name)
            puts "🔄 Switching conversation session to '#{name}'..."

            if @on_reload
              @on_reload.call
              puts "\e[32mSuccessfully switched and hot-loaded session '#{name}'!\e[0m"
            else
              puts "\e[33mSession registered. Please restart chat shell to activate.\e[0m"
            end
          end
        end

        def handle_undo
          if @runner.undo
            puts "✅ Undid last turn."
          else
            puts "⚠️  Nothing to undo."
          end
        end

        def handle_redo
          if @runner.redo
            puts "✅ Redid last turn."
          else
            puts "⚠️  Nothing to redo."
          end
        end

        def handle_model(args)
          config = @config_loader.call
          if args.nil? || args.empty?
            puts "Current model: #{config.dig('llm', 'model') || 'default'}"
            puts "Usage: /model <model_name>"
          else
            update_config("llm", "model", args)
            puts "Model switched to: #{args}"
          end
        end

        def handle_help
          puts "Available commands:"
          puts "  /model <name>    - Switch LLM model"
          puts "  /undo            - Undo last turn (removes from memory)"
          puts "  /redo            - Redo last undone turn"
          puts "  /session [name]  - List, switch, or create new conversation sessions"
          puts "  /help            - Show this help"
          puts "  auto on/off      - Toggle auto mode"
          puts "  exit/quit        - Exit the shell"
        end

        def update_config(section, key, value)
          cfg_path = Aura::PathResolver.resolve_config_path(@project_path)
          data = File.exist?(cfg_path) ? YAML.load_file(cfg_path) : {}
          data[section] ||= {}
          data[section][key] = value
          File.write(cfg_path, YAML.dump(data))
          # Reload config in the caller context if needed via callback,
          # but here we rely on the next call to @config_loader.call to pick it up.
        end
      end
    end
  end
end
