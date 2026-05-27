# frozen_string_literal: true

require "aura"
require "aura/cli/command"

module Aura
  module CLI
    class EntryPoint
      def self.start(argv)
        # Handle allow-root override flag cleanup
        allow_root_flag = argv&.include?("--allow-root")
        argv.delete("--allow-root") if allow_root_flag

        # raise "DEBUG: Entry point reached. CWD: #{Dir.pwd}"
        first = argv&.first
        is_test = (ENV["RACK_ENV"] == "test" || ENV["RAILS_ENV"] == "test" || defined?(Minitest))

        if !allow_root_flag && should_block_root?(argv, first, is_test: is_test)
          puts "\e[31m⛔️  You are trying to run Aura from the source root directory.\e[0m"
          puts "Please run it in a separate workspace directory (e.g., run `aura new my_project` first)."
          exit 1
        end

        if first.nil? || first == "help" || Aura::Command::HELP_MAPPINGS.include?(first)
          argv.shift if first
          Aura::Command.invoke :application, ["help"] + argv
        else
          Aura::Command.invoke :application, argv
        end
      end

      def self.should_block_root?(argv, first, is_test: false)
        return false if ENV["AURA_ALLOW_ROOT"] == "true"
        return false if is_test

        File.exist?("aura.gemspec") && File.exist?("lib/aura.rb") &&
          !argv.include?("--version") && !argv.include?("-v") &&
          !argv.include?("--help") && !argv.include?("-h") &&
          !argv.include?("help") &&
          !["help", "--help", "-h", "doctor", "info", "version", "new", "ask", "list", "delete", "register", "prune", "branch", "config", "hints", "tools", "skill", "kernel", "completion", "h", "t", "s", "k", "c", "v", "i", "web", "update", "template"].include?(first)
      end
    end
  end
end
