require "json"
require "fileutils"

module Aura
  module Kernel
    class State
      def initialize(project_path)
        @project_path = project_path
        @state_dir = File.join(project_path, "state")
        @events = File.join(@state_dir, "events.log")
        @summary = File.join(@state_dir, "summary.txt")
        FileUtils.mkdir_p(@state_dir)
      end

      def record_event(payload)
        File.open(@events, "a") { |f| f.puts(payload.to_json) }
      end

      def metabolize_if_needed
        limit = fetch_max_chars
        return unless limit
        data = File.exist?(@events) ? File.read(@events) : ""
        if data.length > limit
          lines = data.split("\n")
          keep = lines.last([lines.size, 50].min)
          File.write(@events, keep.join("\n"))
          File.write(@summary, summarize_text(keep.join("\n")))
        end
      end

      def get_latest_summary
        File.exist?(@summary) ? File.read(@summary) : nil
      end

      def get_active_variables
        {}
      end

      def get_recent_events
        File.exist?(@events) ? File.read(@events).split("\n").last(5).join("\n") : nil
      end

      private
        def fetch_max_chars
          cfg = File.join(@project_path, "config", "config.yml")
          return nil unless File.exist?(cfg)
          begin
            require "yaml"
            data = YAML.load_file(cfg)
            data.dig("state_management", "max_state_chars")
          rescue StandardError
            nil
          end
        end

        def summarize_text(t)
          "Recent events compressed: #{t.lines.count} lines"
        end
    end
  end
end
