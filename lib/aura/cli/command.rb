# frozen_string_literal: true

require "thor"

module Aura
  module Command
    HELP_MAPPINGS = %w(-h --help help)

    class << self
      def invoke(full_command, args = [], **config)
        command_name = full_command.to_s
        
        if command_name == "application"
          require "aura/cli/commands/application_command"
          Aura::Commands::ApplicationCommand.start(args, config)
        else
          # Fallback or other commands
          puts "Unknown command: #{command_name}"
        end
      end
    end
  end
end
