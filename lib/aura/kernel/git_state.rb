# frozen_string_literal: true

require "open3"
require "fileutils"

module Aura
  module Kernel
    class GitState
      def initialize(project_path)
        @project_path = project_path
      end

      def snapshot(tool_name, success: true)
        return unless git_repo?

        # We only snapshot on success by default
        return unless success

        message = "[Aura] Tool execution: #{tool_name}"

        # Add all changes (except state/ which should be gitignored)
        Open3.capture3("git", "add", ".", chdir: @project_path)

        # Check if there are changes to commit
        out, _err, = Open3.capture3("git", "status", "--porcelain", chdir: @project_path)
        return if out.to_s.strip.empty?

        # Commit
        Open3.capture3("git", "commit", "-m", message, chdir: @project_path)
      end

      private

      def git_repo?
        Dir.exist?(File.join(@project_path, ".git"))
      end
    end
  end
end
