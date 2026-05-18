# frozen_string_literal: true

module Aura
  module Context
    # Responsible for loading OpenClaw-style Markdown workspace files
    # to provide rich, human-readable context about the agent's persona,
    # rules, user preferences, and tool guidelines.
    class MarkdownWorkspaceProvider
      FILES = {
        soul: "SOUL.md",           # Persona, tone, boundaries
        agents: "AGENTS.md",       # Operating instructions, rules
        user: "USER.md",           # User profile, preferences
        tools: "TOOLS.md",         # Tool usage guidelines, tips
        identity: "IDENTITY.md",   # Agent name, emoji, self-concept
        memory: "MEMORY.md"        # Curated long-term memory
      }.freeze

      def initialize(project_path)
        @project_path = project_path
      end

      def provide
        sections = []

        FILES.each do |key, filename|
          content = read_file(filename)
          next if content.nil? || content.empty?

          header = case key
                   when :soul then "# AGENT PERSONA (SOUL)"
                   when :agents then "# OPERATING INSTRUCTIONS"
                   when :user then "# USER CONTEXT"
                   when :tools then "# TOOL GUIDELINES"
                   when :identity then "# AGENT IDENTITY"
                   when :memory then "# LONG-TERM MEMORY"
                   else "# #{filename.upcase}"
                   end

          sections << "#{header}\n#{content}"
        end

        # Also load recent daily memory logs if available
        daily_memory = load_recent_daily_memory
        sections << daily_memory if daily_memory

        return nil if sections.empty?
        sections.join("\n\n")
      end

      private

      def read_file(filename)
        # Search in project root and .aura/instructions/
        candidates = [
          File.join(@project_path, filename),
          File.join(@project_path, ".aura", "instructions", filename),
          File.join(@project_path, "instructions", filename)
        ]

        path = candidates.find { |f| File.exist?(f) }
        return nil unless path

        File.read(path).strip
      end

      def load_recent_daily_memory
        memory_dir = File.join(@project_path, "memory")
        return nil unless Dir.exist?(memory_dir)

        # Get the last 2 daily logs (yesterday + today)
        logs = Dir.glob(File.join(memory_dir, "*.md")).sort.last(2)
        return nil if logs.empty?

        content = logs.map do |log|
          date = File.basename(log, ".md")
          "## Memory Log (#{date})\n#{File.read(log).strip}"
        end.join("\n\n")

        "# RECENT MEMORY LOGS\n#{content}"
      end
    end
  end
end
