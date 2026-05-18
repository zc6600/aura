# frozen_string_literal: true

require "thor"
require "aura/cli/shell/session"

module Aura
  module Commands
    class ShellCommand < Thor
      def self.exit_on_failure?
        true
      end

      desc "start PROJECT_PATH", "Start an interactive Aura chat session"
      method_option :verbose, type: :boolean, aliases: "-v", desc: "Show detailed output"
      method_option :session, type: :string, aliases: "-s", desc: "Start chat with a specific session database"
      method_option :new_session, type: :boolean, aliases: "-n", desc: "Start a brand new timestamped chat session"
      def start(project_path)
        session_name = options[:session]
        if options[:new_session]
          session_name = "session_#{Time.now.strftime('%Y%m%d_%H%M%S')}"
        end

        if session_name && !session_name.to_s.strip.empty?
          ENV["AURA_SESSION_NAME"] = session_name.to_s
          require "fileutils"
          env_path = Aura.environment_path(File.expand_path(project_path))
          active_txt = File.join(env_path, "state", "active_session.txt")
          begin
            FileUtils.mkdir_p(File.dirname(active_txt))
            File.write(active_txt, session_name.to_s)
          rescue StandardError
          end
        end

        Aura::CLI::Shell::Session.new(project_path, options).start
      end
    end
  end
end
