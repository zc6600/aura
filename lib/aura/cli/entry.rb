# frozen_string_literal: true

require "aura"
require "aura/cli/command"

module Aura
  module CLI
    class EntryPoint
      def self.start(argv)
        # raise "DEBUG: Entry point reached. CWD: #{Dir.pwd}"
        # Prevent running from source root (unless asking for help/version/doctor/new/ask)
        if File.exist?("aura.gemspec") && File.exist?("lib/aura.rb") && !argv.include?("--version") && !argv.include?("-v")
           first = argv&.first
           unless ["help", "--help", "-h", "doctor", "version", "new", "ask"].include?(first)
             puts "\e[31m⛔️  You are trying to run Aura from the source root directory.\e[0m"
             puts "Please run it in a separate mission directory (e.g., `tmp_mission_00`)."
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
