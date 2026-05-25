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
      method_option :mode, type: :string, default: "classic", desc: "Run loop mode: classic or ralph"
      method_option :verify, type: :string, desc: "Verify test command for Ralph Loop"
      method_option :critic, type: :boolean, default: false, desc: "Use Critic LLM instead of test command for Ralph Loop"
      method_option :max_steps, type: :numeric, desc: "Maximum steps/calls in Ralph Loop"
      def start(project_path, external_opts = {})
        merged_opts = options.to_h.merge(external_opts.to_h)
        session_name = merged_opts[:session] || merged_opts["session"]
        session_name = "session_#{Time.now.strftime('%Y%m%d_%H%M%S')}" if merged_opts[:new_session] || merged_opts["new_session"]

        if session_name && !session_name.to_s.strip.empty?
          # Validate session name for security
          begin
            session_name = Aura::PathResolver.sanitize_session_name(session_name)
          rescue ArgumentError => e
            puts "\e[31m⛔️ Error: Invalid session name: #{e.message}\e[0m"
            exit 1
          end

          ENV["AURA_SESSION_NAME"] = session_name.to_s
          require "fileutils"
          env_path = Aura::PathResolver.environment_path(File.expand_path(project_path))
          active_txt = File.join(env_path, "state", "active_session.txt")
          begin
            FileUtils.mkdir_p(File.dirname(active_txt))
            File.write(active_txt, session_name.to_s)
          rescue StandardError
          end
        end

        Aura::CLI::Shell::Session.new(project_path, merged_opts).start
      end
    end
  end
end
