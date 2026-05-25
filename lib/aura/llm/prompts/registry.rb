# frozen_string_literal: true

require "monitor"
require "aura/llm/prompts/compose"
require "aura/llm/prompts/ralph_prompt"

module Aura
  module LLM
    module Prompts
      class Registry
        @cache = {}
        @cache_mutex = Monitor.new

        SECTIONS = %w[
          01_mission.md
          02_workspace.md
          03_operational_rules.md
          04_tool_spec.md
          05_skill_spec.md
          06_constraints.md
        ].freeze

        class << self
          # Read file with stat-based caching and yaml frontmatter stripping
          def read_file_cached(path)
            return nil unless File.exist?(path)

            @cache_mutex.synchronize do
              mtime = File.mtime(path)
              cached = @cache[path]
              if cached && cached[:mtime] == mtime
                cached[:content]
              else
                content = File.read(path, encoding: "utf-8")
                # Strip front-matter YAML header if present
                if content.start_with?("---")
                  parts = content.split("---", 3)
                  content = parts[2] || content
                end
                cleaned = content.strip + "\n"
                @cache[path] = { mtime: mtime, content: cleaned }
                cleaned
              end
            end
          end

          # Clear the registry cache
          def clear_cache!
            @cache_mutex.synchronize do
              @cache.clear
            end
          end

          # Resolve prompts by mode and priority
          def resolve(mode, project_path, options = {})
            case mode.to_sym
            when :standard
              # Check for legacy single-file override
              legacy_path = find_file_in_workspace(project_path, [
                "skills/system.md",
                ".aura/skills/system.md",
                "prompts/system.md",
                ".aura/prompts/system.md"
              ])

              custom = if legacy_path
                         read_file_cached(legacy_path)
                       else
                         # Compose modularly
                         compose_modular_system_prompt(project_path)
                       end

              if legacy_path
                custom
              else
                # Ensure it starts with the expected header
                header = "# AURA OS OPERATING PROTOCOL"
                if custom.start_with?(header)
                  custom
                else
                  "#{header}\n\n#{custom}"
                end
              end

            when :ralph_developer
              # Ralph base protocol
              base = Aura::LLM::Prompts::RALPH_PROTOCOL_PROMPT

              # Ralph user directives override
              ralph_path = find_file_in_workspace(project_path, [
                "prompts/ralph_system.md",
                ".aura/prompts/ralph_system.md",
                "skills/ralph_system.md",
                ".aura/skills/ralph_system.md"
              ])

              custom = if ralph_path
                         read_file_cached(ralph_path)
                       else
                         Aura::LLM::Prompts::DEFAULT_RALPH_USER_DIRECTIVES
                       end

              "#{base}\n\n#{custom}"

            when :ralph_critic
              # Critic base protocol
              base = Aura::LLM::Prompts::CRITIC_PROTOCOL_PROMPT

              # Critic rules override
              critic_path = find_file_in_workspace(project_path, [
                "prompts/critic_rules.md",
                ".aura/prompts/critic_rules.md",
                "skills/critic_rules.md",
                ".aura/skills/critic_rules.md"
              ])

              custom = if critic_path
                         read_file_cached(critic_path)
                       else
                         Aura::LLM::Prompts::DEFAULT_CRITIC_AUDIT_RULES
                       end

              "#{base}\n\n#{custom}"

            else
              raise ArgumentError, "Unknown mode: #{mode}"
            end
          end

          # Basic validation rules for dry-runs and sync checks
          # Returns a list of strings detailing errors/warnings. Empty if valid.
          def validate_prompt(content)
            issues = []
            return ["Prompt content is empty"] if content.to_s.strip.empty?

            # 1. JSON formatting rules verification
            unless content.include?("JSON") || content.include?("json")
              issues << "Warning: Prompt does not mention JSON output structure."
            end

            # 2. Strict response format verification
            unless content.include?("tool") && content.include?("args")
              issues << "Warning: Prompt may lack structural tool calling rules (missing 'tool' or 'args')."
            end

            # 3. Template placeholders validation
            if content.include?("{{") && !content.include?("{{project_path}}")
              issues << "Warning: Contains unresolved template placeholders (unrecognized double curly braces)."
            end

            issues
          end

          private

          def find_file_in_workspace(project_path, relative_paths)
            return nil if project_path.nil?

            workspace_root = File.expand_path(project_path)
            limit = if defined?(Aura::PathResolver)
                      aura_dir = Aura::PathResolver.find_aura_dir(workspace_root)
                      aura_dir ? File.dirname(aura_dir) : Aura::PathResolver.workspace_path(workspace_root)
                    else
                      workspace_root
                    end
            limit = File.expand_path(limit || workspace_root)

            dir = workspace_root
            while dir
              relative_paths.each do |rel_path|
                path = File.join(dir, rel_path)
                return path if File.exist?(path)
              end
              break if dir == limit || dir == File.dirname(dir)
              dir = File.dirname(dir)
            end
            nil
          end

          def compose_modular_system_prompt(project_path)
            SECTIONS.map do |section|
              # Check for workspace override for this section
              section_override = find_file_in_workspace(project_path, [
                "prompts/system/#{section}",
                ".aura/prompts/system/#{section}",
                "skills/system/#{section}",
                ".aura/skills/system/#{section}"
              ])

              if section_override
                read_file_cached(section_override)
              else
                # Load framework default
                default_path = File.expand_path("system/#{section}", __dir__)
                if File.exist?(default_path)
                  read_file_cached(default_path)
                else
                  ""
                end
              end
            end.compact.join("\n\n")
          end
        end
      end
    end
  end
end
