# frozen_string_literal: true

require "thor"

module Aura
  module Commands
    class VersionCommand < Thor
      default_task :version

      def self.exit_on_failure?
        true
      end

      desc "version", "Show Aura version"
      def version
        puts "Aura #{Aura::VERSION}"
      end
    end
  end
end
