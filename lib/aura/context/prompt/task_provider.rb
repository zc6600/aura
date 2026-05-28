# frozen_string_literal: true

module Aura
  module Context
    class Prompt
      class TaskProvider
        def initialize(project_path)
          @project_path = project_path
        end

        def provide
          file = resolve_task_path
          return nil if file.nil? || file.empty?

          content = File.read(file, encoding: "utf-8").strip
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
end
