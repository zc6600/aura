# frozen_string_literal: true

require "aura/llm/prompts/registry"

module Aura
  module Context
    class DirectiveProvider
      def initialize(project_path, options = {})
        @project_path = project_path
        @options = options || {}
      end

      def provide
        active_skill_path = resolve_active_skill_path
        content = if active_skill_path
                    Aura::LLM::Prompts::Registry.read_file_cached(active_skill_path)
                  else
                    mode = @options[:directive_mode] || :standard
                    Aura::LLM::Prompts::Registry.resolve(mode.to_sym, @project_path, @options)
                  end

        return "" if content.nil? || content.empty?

        content
          .gsub("{{project_path}}", @project_path)
          .strip + "\n"
      end

      private

      def resolve_active_skill_path
        active = @options[:active_skill] || ENV.fetch("AURA_ACTIVE_SKILL", nil)
        return nil if active.nil? || active.to_s.strip.empty?

        candidates = []
        dir = File.expand_path(@project_path)
        while dir && dir != File.dirname(dir)
          candidates << File.join(dir, "skills", active.to_s, "SKILL.md")
          candidates << File.join(dir, ".aura", "skills", active.to_s, "SKILL.md") if File.directory?(File.join(dir, ".aura"))
          dir = File.dirname(dir)
        end
        # Also check inside the gem templates directory
        candidates << File.join(File.expand_path("../generators/aura/app/templates/skills", __dir__), active.to_s, "SKILL.md")
        
        candidates.find { |path| File.exist?(path) }
      end

      def resolve_system_prompt_path
        candidates = []
        dir = File.expand_path(@project_path)
        while dir && dir != File.dirname(dir)
          candidates << File.join(dir, "skills", "system.md")
          candidates << File.join(dir, ".aura", "skills", "system.md") if File.directory?(File.join(dir, ".aura"))
          dir = File.dirname(dir)
        end
        # Also check inside the gem templates directory
        candidates << File.join(File.expand_path("../generators/aura/app/templates/skills", __dir__), "system.md")
        
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
