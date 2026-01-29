# frozen_string_literal: true

require "aura/command"

module Aura
  class CLI
    def self.start(argv)
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
