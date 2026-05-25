# frozen_string_literal: true

require "aura"
require "aura/config_loader"
require_relative "directive_provider" # includes TaskProvider
require_relative "environment_provider"
require_relative "knowledge_provider"
require_relative "lsp_provider"
require_relative "tool_provider"
require_relative "state_provider"
require_relative "markdown_workspace_provider"

module Aura
  module Context
    class Base
      def initialize(project_path, db, options = {})
        @project_path = File.expand_path(project_path)
        @env_path = Aura::PathResolver.environment_path(@project_path)
        @db = db
        @providers = [
          DirectiveProvider.new(@project_path, options),
          MarkdownWorkspaceProvider.new(@project_path), # Added Markdown Workspace support
          EnvironmentProvider.new(@project_path, env_path: @env_path),
          KnowledgeProvider.new(@project_path),
          LSPProvider.new(@project_path, options[:lsp_manager]),
          ToolProvider.new(@env_path, options.merge(state: db)),
          TaskProvider.new(@project_path),
          StateProvider.new(db, options)
        ].compact
      end

      def assemble
        content = @providers.map(&:provide).compact.join("\n\n")
        limit = fetch_max_chars(@project_path)
        final_content = if limit&.to_i&.positive? && content.length > limit
                          compress_content(content, limit)
                        else
                          content
                        end

        tool_provider = @providers.find { |p| p.is_a?(ToolProvider) }
        tools = tool_provider ? tool_provider.provide_structured : []

        sections = split_sections(final_content)
        Aura::Context::Payload.new(sections, tools)
      end

      private

      def fetch_max_chars(path)
        env_path = Aura::PathResolver.environment_path(path)
        cfg = Aura::ConfigLoader.load(env_path, safe: true)
        cfg.dig("state_management", "max_state_chars")
      rescue Aura::ConfigLoader::ConfigError, ArgumentError, TypeError
        nil
      end

      def compress_content(content, limit)
        sections = split_sections(content)
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

        out
      end

      def headers_map
        {
          directive: "# AURA OS OPERATING PROTOCOL",
          workspace: "# OPERATING INSTRUCTIONS", # Map for MarkdownWorkspaceProvider content (heuristic)
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

      # other strategies removed; we only apply state_priority_compress, then hard-limit cut

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
        new_state = [pre, new_history_block, av_block].compact.join("")
        sections[:state] = new_state

        def calc_total(sects)
          sects.values.compact.join("\n\n").length
        end

        return sections if calc_total(sections) <= limit

        # Step 2: reduce number of events kept (drop older first) until threshold
        while calc_total(sections) > limit && events.size > min_event_threshold
          events.shift
          new_history_block = ([header] + events).join("\n")
          sections[:state] = [pre, new_history_block, av_block].compact.join("")
        end

        if calc_total(sections) > limit && summary_trim_step.positive?
          while calc_total(sections) > limit && events.size.positive?
            drop = [summary_trim_step, events.size].min
            events.shift(drop)
            new_history_block = ([header] + events).join("\n")
            sections[:state] = [pre, new_history_block, av_block].compact.join("")
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
          sections[:state] = [pre, new_history_block, av_block].compact.join("")
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
