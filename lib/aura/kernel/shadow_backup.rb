# frozen_string_literal: true

require "open3"
require "fileutils"

module Aura
  module Kernel
    class ShadowBackup
      MAX_FILE_SIZE = 1024 * 1024 # 1MB

      def initialize(project_path)
        @project_path = File.expand_path(project_path)
        @env_path = Aura::PathResolver.environment_path(@project_path)
        @shadow_path = File.join(@env_path, "shadow")
        @shadow_git = File.join(@shadow_path, ".git")
      end

      # Record any changed files in the project to the shadow workspace
      def record_changes(tool_name, tool_args = {})
        ensure_shadow_git_initialized!

        changed_files = []
        if File.exist?(File.join(@project_path, ".git"))
          # Use git status to find modified or untracked files
          out, _err, status = Open3.capture3("git", "status", "--porcelain", chdir: @project_path)
          if status.success?
            out.each_line do |line|
              # line format: " M path/to/file.py" or "?? path/to/file.py"
              filepath = line[3..].to_s.strip
              filepath = filepath.gsub(/\A"|"\z/, "") # strip quotes if git quotes the path
              changed_files << filepath
            end
          end
        else
          # Fallback: parse specific file writing arguments
          if tool_args.is_a?(Hash)
            file_path = tool_args["file_path"] || tool_args["path"]
            changed_files << file_path if file_path && !file_path.to_s.strip.empty?
          end
        end

        changed_files = changed_files.compact.uniq
        copied_any = false

        changed_files.each do |rel_path|
          abs_src = File.expand_path(rel_path, @project_path)

          # Ignore directories, non-existent files, and large files
          next unless File.file?(abs_src)
          next if File.size(abs_src) > MAX_FILE_SIZE

          # Prevent backing up the environment folder or files outside workspace
          next if rel_path.start_with?(".aura/") || rel_path.include?("/.aura/")

          begin
            real_src = File.realpath(abs_src)
            real_project = File.realpath(@project_path)
            next unless real_src.start_with?(real_project)
          rescue StandardError
            next
          end

          # Skip if ignored in the user's project git
          if File.exist?(File.join(@project_path, ".git"))
            _, _err, ignore_status = Open3.capture3("git", "check-ignore", rel_path, chdir: @project_path)
            next if ignore_status.success?
          end

          # Copy file into shadow path
          abs_dest = File.expand_path(rel_path, @shadow_path)
          FileUtils.mkdir_p(File.dirname(abs_dest))
          FileUtils.cp(abs_src, abs_dest)
          copied_any = true
        end

        if copied_any
          # Commit modifications into the shadow git repo
          message = "[Aura] Tool execution: #{tool_name}"
          Open3.capture3("git", "add", ".", chdir: @shadow_path)
          Open3.capture3("git", "commit", "-m", message, chdir: @shadow_path)
        end
      rescue StandardError => e
        # Fail-safe: don't break execution if backup error occurs
        warn "ShadowBackup Error: #{e.message}"
      end

      private

      def ensure_shadow_git_initialized!
        return if File.directory?(@shadow_git)

        FileUtils.mkdir_p(@shadow_path)
        Open3.capture3("git", "init", chdir: @shadow_path)
        Open3.capture3("git", "config", "user.name", "Aura Shadow Backup", chdir: @shadow_path)
        Open3.capture3("git", "config", "user.email", "shadow@aura-os.ai", chdir: @shadow_path)

        # Create initial commit
        gitignore_path = File.join(@shadow_path, ".gitignore")
        File.write(gitignore_path, "") unless File.exist?(gitignore_path)
        Open3.capture3("git", "add", ".gitignore", chdir: @shadow_path)
        Open3.capture3("git", "commit", "-m", "Initial commit", chdir: @shadow_path)
      end
    end
  end
end
