# frozen_string_literal: true

require "aura"
require "aura/cli/command"

module Aura
  module CLI
    class EntryPoint
      def self.start(argv)
        # raise "DEBUG: Entry point reached. CWD: #{Dir.pwd}"
        first = argv&.first
         if File.exist?("aura.gemspec") && File.exist?("lib/aura.rb") && !argv.include?("--version") && !argv.include?("-v")
            unless ["help", "--help", "-h", "doctor", "version", "new", "ask", "list", "delete", "register", "prune", "branch", "config"].include?(first)
              puts "\e[31m⛔️  You are trying to run Aura from the source root directory.\e[0m"
              puts "Please run it in a separate workspace directory (e.g., run `aura new my_project` first)."
              exit 1
            end
         end

        first = argv&.first
        if first.nil? || first == "help" || Aura::Command::HELP_MAPPINGS.include?(first)
          argv.shift if first
          Aura::Command.invoke :application, ["help"] + argv
        else
          Aura::Command.invoke :application, argv
        end
      end
    end
  end
end
