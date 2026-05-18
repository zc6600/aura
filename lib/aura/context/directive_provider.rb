# frozen_string_literal: true

module Aura
  module Context
    class DirectiveProvider
      def initialize(project_path)
        @project_path = project_path
      end

      def provide
        file = resolve_system_prompt_path
        return "" unless File.exist?(file)
        content = File.read(file)
        content
          .gsub("{{project_path}}", @project_path)
          .strip + "\n"
      end

      private
        def resolve_system_prompt_path
          candidates = []
          dir = File.expand_path(@project_path)
          while dir && dir != File.dirname(dir)
            candidates << File.join(dir, "skills", "system.md")
            candidates << File.join(dir, "lib", "aura", "generators", "aura", "app", "templates", "skills", "system.md")
            dir = File.dirname(dir)
          end
          candidates.find { |path| File.exist?(path) } || ""
        end
    end

    class TaskProvider
      def initialize(project_path)
        @project_path = project_path
      end

      def provide
        file = resolve_task_path
        return nil if file.nil? || file.empty?
        content = File.read(file).strip
        return nil if content.empty?
        "# LONG-RUN TASK\n#{content}"
      end

      private
        def resolve_task_path
          dir = File.expand_path(@project_path)
          while dir && dir != File.dirname(dir)
            file = File.join(dir, "task.md")
            return file if File.exist?(file)
            dir = File.dirname(dir)
          end
          nil
        end
    end
  end
end
