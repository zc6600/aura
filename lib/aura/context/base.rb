# frozen_string_literal: true

require "aura"
require "aura/config_loader"

require_relative "prompt/directive_provider"
require_relative "prompt/workspace_provider"
require_relative "prompt/task_provider"
require_relative "env_provider/environment_provider"
require_relative "env_provider/lsp_provider"
require_relative "env_provider/knowledge_provider"
require_relative "env_provider/tool_provider"
require_relative "memory/state_provider"
require_relative "prompt"
require_relative "env_provider"
require_relative "memory"

module Aura
  module Context
    class Base
      def initialize(project_path, db, options = {})
        @project_path = File.expand_path(project_path)
        @env_path = Aura::PathResolver.environment_path(@project_path)
        @db = db
        @options = options || {}

        @directive_provider = Aura::Context::Prompt::DirectiveProvider.new(@project_path, @options)
        @workspace_provider = Aura::Context::Prompt::WorkspaceProvider.new(@project_path)
        @task_provider = Aura::Context::Prompt::TaskProvider.new(@project_path)

        @environment_provider = Aura::Context::EnvProvider::EnvironmentProvider.new(@project_path, env_path: @env_path)
        @lsp_provider = Aura::Context::EnvProvider::LSPProvider.new(@project_path, @options[:lsp_manager])
        @knowledge_provider = Aura::Context::EnvProvider::KnowledgeProvider.new(@project_path)
        @tool_provider = Aura::Context::EnvProvider::ToolProvider.new(@env_path, @options.merge(state: db))

        @state_provider = Aura::Context::Memory::StateProvider.new(db, @options)
      end

      def assemble
        raw_sections = {
          directive: @directive_provider.provide,
          workspace: @workspace_provider.provide,
          task: @task_provider.provide,
          env: @environment_provider.provide,
          lsp: @lsp_provider.provide,
          knowledge: @knowledge_provider.provide,
          state: @state_provider.provide
        }

        tool_content = @tool_provider.provide
        tool_secs = split_tool_sections(tool_content)
        raw_sections[:active] = tool_secs[:active]
        raw_sections[:index] = tool_secs[:index]

        total_len = raw_sections.values.compact.join("\n\n").length
        limit = fetch_max_chars(@project_path)

        sections = if limit&.to_i&.positive? && total_len > limit
                     compress_sections(raw_sections, limit)
                   else
                     raw_sections
                   end

        tools = @tool_provider.provide_structured

        prompt = Aura::Context::Prompt.new(
          sections[:directive],
          sections[:workspace],
          sections[:task]
        )

        env_provider = Aura::Context::EnvProvider.new(
          overview: sections[:env],
          lsp: sections[:lsp],
          knowledge: sections[:knowledge]
        )

        memory = Aura::Context::Memory.new(
          state: sections[:state]
        )

        Aura::Context::Payload.new(prompt, env_provider, memory, tools, @options, sections)
      end

      private

      def split_tool_sections(content)
        active_tag = "# ACTIVE TOOLS (Ready to use)"
        index_tag = "# TOOL INDEX (Use 'inspect_tool' to see details)"

        active_idx = content.to_s.index(active_tag)
        index_idx = content.to_s.index(index_tag)

        active_part = nil
        index_part = nil

        if active_idx && index_idx
          if active_idx < index_idx
            active_part = content[active_idx...index_idx].strip
            index_part = content[index_idx..].strip
          else
            index_part = content[index_idx...active_idx].strip
            active_part = content[active_idx..].strip
          end
        elsif active_idx
          active_part = content[active_idx..].strip
        elsif index_idx
          index_part = content[index_idx..].strip
        end

        { active: active_part, index: index_part }
      end

      def fetch_max_chars(path)
        env_path = Aura::PathResolver.environment_path(path)
        cfg = Aura::ConfigLoader.load(env_path, safe: true)
        cfg.dig("state_management", "max_state_chars")
      rescue Aura::ConfigLoader::ConfigError, ArgumentError, TypeError
        nil
      end

      def compress_sections(sections, limit)
        sections = sections.dup
        sections = state_priority_compress(sections, limit)
        order = headers_map.keys

        sections = drop_sections_until_fit(sections, limit, order)
        out = order.map { |k| sections[k] }.compact.join("\n\n")

        if out.length > limit
          sections = aggressive_state_trim(sections, limit, order)
          out = order.map { |k| sections[k] }.compact.join("\n\n")
        end

        if out.length > limit
          if @db.respond_to?(:commit_summary)
            @db.commit_summary("Context assembly failed: compressed length #{out.length} exceeds max_state_chars #{limit}.")
          end
          raise Aura::Context::ContextOverflowError, "Compressed context length #{out.length} exceeds max_state_chars #{limit}"
        end

        sections
      end

      def headers_map
        {
          directive: "# AURA OS OPERATING PROTOCOL",
          workspace: "# OPERATING INSTRUCTIONS",
          task: "# LONG-RUN TASK",
          active: "# ACTIVE TOOLS (Ready to use)",
          index: "# TOOL INDEX (Use 'inspect_tool' to see details)",
          knowledge: "# PROJECT KNOWLEDGE BASE (Persistent Facts)",
          state: "# AGENT STATE & MEMORY",
          env: "# SYSTEM & ENVIRONMENT",
          lsp: "# CODE HEALTH (LSP Diagnostics)"
        }
      end

      def split_sections(content)
        h = headers_map
        positions = h.map { |k, v| [k, content.index(v)] }.select { |_, i| i }
        positions.sort_by! { |_, i| i }
        out = {}
        positions.each_with_index do |(k, idx), i|
          nxt = positions[i + 1]&.last || content.length
          out[k] = content[idx...nxt]
        end
        out
      end

      def state_priority_compress(sections, limit)
        return sections unless sections[:state]

        current = sections[:state]

        total_len = sections.values.compact.join("\n\n").length
        return sections if total_len <= limit

        cfg = load_full_config
        cc = cfg["context_compression"] || {}
        per_event_cap = (cc["event_max_chars"] || 800).to_i
        min_event_threshold = (cc["event_min_count_threshold"] || 10).to_i
        summary_trim_step = (cc["summary_trim_step"] || 5).to_i

        # Parse blocks inside state section
        history_tag = "### History:"
        av_tag = "### Active Variables:"

        history_idx = current.index(history_tag)
        av_idx = current.index(av_tag)

        pre = current[0, history_idx] if history_idx
        history_block = if history_idx && av_idx
                          current[history_idx, av_idx - history_idx]
                        elsif history_idx
                          current[history_idx, current.length - history_idx]
                        end

        av_block = (current[av_idx, current.length - av_idx] if av_idx)

        return sections unless history_block

        history_lines = history_block.split("\n")
        header = history_lines.shift
        events = history_lines.dup

        # Step 1: truncate long single events
        if per_event_cap.positive?
          truncated = events.map do |line|
            if line && line.length > per_event_cap
              notice = "...[truncated; full payload in state/aura.db (events.payload); use sqlite3 to query]"
              max_body = per_event_cap - notice.length
              max_body = 0 if max_body.negative?
              (max_body.positive? ? line[0, max_body] : "") + notice
            else
              line
            end
          end
          events = truncated
        end

        # Rebuild state section and check length
        new_history_block = ([header] + events).join("\n")
        new_state = [pre, new_history_block, av_block].compact.join
        sections[:state] = new_state

        calc_total = ->(sects) { sects.values.compact.join("\n\n").length }

        return sections if calc_total.call(sections) <= limit

        # Step 2: reduce number of events kept (drop older first) until threshold
        while calc_total.call(sections) > limit && events.size > min_event_threshold
          events.shift
          new_history_block = ([header] + events).join("\n")
          sections[:state] = [pre, new_history_block, av_block].compact.join
        end

        if calc_total.call(sections) > limit && summary_trim_step.positive?
          while calc_total.call(sections) > limit && events.size.positive?
            drop = [summary_trim_step, events.size].min
            events.shift(drop)
            new_history_block = ([header] + events).join("\n")
            sections[:state] = [pre, new_history_block, av_block].compact.join
          end
        end

        sections
      end

      def drop_sections_until_fit(sections, limit, _order)
        total_len = sections.values.compact.join("\n\n").length
        return sections if total_len <= limit
        return sections if limit.to_i < 1000

        drop_order = %i[lsp workspace env index active task directive]
        drop_order.each do |key|
          next unless sections[key]

          sections[key] = nil
          total_len = sections.values.compact.join("\n\n").length
          return sections if total_len <= limit
        end

        sections
      end

      def aggressive_state_trim(sections, limit, _order)
        return sections unless sections[:state]
        return sections if sections.values.compact.join("\n\n").length <= limit

        return sections if limit.to_i < 1000

        current = sections[:state]
        history_tag = "### History:"
        av_tag = "### Active Variables:"

        history_idx = current.index(history_tag)
        av_idx = current.index(av_tag)
        return sections unless history_idx

        pre = current[0, history_idx]
        history_block = if av_idx
                          current[history_idx, av_idx - history_idx]
                        else
                          current[history_idx, current.length - history_idx]
                        end
        av_block = av_idx ? current[av_idx, current.length - av_idx] : nil

        history_lines = history_block.split("\n")
        header = history_lines.shift
        events = history_lines.dup

        while sections.values.compact.join("\n\n").length > limit && events.size > 1
          events.shift
          new_history_block = ([header] + events).join("\n")
          sections[:state] = [pre, new_history_block, av_block].compact.join
        end

        sections
      end

      def load_full_config
        Aura::ConfigLoader.load(@env_path, safe: true)
      rescue Aura::ConfigLoader::ConfigError, ArgumentError, TypeError
        {}
      end
    end
  end
end
