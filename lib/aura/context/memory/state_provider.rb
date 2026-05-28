# frozen_string_literal: true

module Aura
  module Context
    class Memory
      # StateProvider: Read-side adapter that formats runtime memory into a Markdown section
      # for context assembly.
      #
      # When given an `Aura::Memory::Base` instance (the modern path), it delegates directly
      # to `Aura::Memory::Provider#to_markdown` — the single source of truth for memory
      # formatting.
      #
      # When given a legacy db object (Aura::Kernel::State or similar), it falls back to
      # the compatibility adapter so old callers continue to work unchanged.
      class StateProvider
        def initialize(db, options = {})
          @options = options || {}

          if db.is_a?(Aura::Memory::Base)
            # Modern path: delegate directly — no duplication of formatting logic
            @memory = db
            @db = nil
          else
            # Legacy path: wrap old db interface
            @memory = nil
            if db.nil?
              @db = nil
            else
              require "aura/memory/adapters/compatibility_adapter"
              @db = Aura::Memory::Adapters::CompatibilityAdapter.new(db) rescue db
            end
          end
        end

        def provide
          # Modern path: single source of truth
          return @memory.provider.to_markdown(options: @options) if @memory

          # Legacy path: still supported for backward compat
          return nil unless @db

          legacy_provide
        end

        private

        # Legacy formatting path — kept for backward compat with Aura::Kernel::State
        # TODO: remove once all callers pass Aura::Memory::Base
        def legacy_provide
          require "aura/memory/provider"

          # Build a temporary Provider-like object that wraps the legacy db
          section = ["# AGENT STATE & MEMORY"]
          history_entries = []
          fallback_seq = 0

          # Summaries
          if @db.respond_to?(:get_recent_summaries_structured)
            summaries = @db.get_recent_summaries_structured || []
            summaries.each do |s|
              content = s["content"] || s[:content]
              next if content.to_s.strip.empty?

              ts = (s["timestamp"] || s[:timestamp]).to_i
              seq = (s["source_event_id"] || s[:source_event_id] || s["id"] || s[:id]).to_i
              body = content.to_s.gsub(/\s+/, " ").strip
              history_entries << { ts: ts, seq: seq, order: 2, id: (s["id"] || s[:id]).to_i, body: "Summary: #{body}" }
            end
          elsif @db.respond_to?(:get_recent_summaries)
            @db.get_recent_summaries.to_s.split("\n").each do |line|
              body = line.to_s.gsub(/\s+/, " ").strip
              next if body.empty?

              fallback_seq += 1
              history_entries << { ts: 0, seq: fallback_seq, order: 2, id: 0, body: "Summary: #{body}" }
            end
          elsif @db.respond_to?(:get_latest_summary)
            @db.get_latest_summary.to_s.split("\n").each do |line|
              body = line.to_s.gsub(/\s+/, " ").strip
              next if body.empty?

              fallback_seq += 1
              history_entries << { ts: 0, seq: fallback_seq, order: 2, id: 0, body: "Summary: #{body}" }
            end
          end

          # Active variables
          if @db.respond_to?(:get_active_variables)
            vars = @db.get_active_variables || {}
            unless vars.empty?
              lines = format_variables(vars)
              section << "### Active Variables:\n#{lines.join("\n")}" unless lines.empty?
            end
          end

          # Events
          events = fetch_legacy_events
          events.each do |e|
            entry = format_legacy_event(e, fallback_seq)
            history_entries << entry if entry
          end

          if history_entries.any?
            ordered = history_entries.sort_by { |e| [e[:seq].to_i, e[:order].to_i, e[:id].to_i] }
            threshold = (@options[:event_time_gap_seconds] || 60).to_i
            lines = format_history_entries(ordered, threshold)
            section << "### History:\n#{lines.join("\n")}"
          end

          section.join("\n")
        end

        def fetch_legacy_events
          if @db.respond_to?(:get_recent_events_structured)
            opts = { limit: nil, phases: %w[user plan execution interception observe milestone] }
            @db.get_recent_events_structured(opts) || []
          else
            []
          end
        end

        def format_legacy_event(e, _fallback_seq) # rubocop:disable Metrics/AbcSize, Metrics/CyclomaticComplexity, Metrics/MethodLength, Metrics/PerceivedComplexity
          ts = e["timestamp"].to_i
          phase = e["phase"].to_s
          tool = e["tool"]
          pl = e["payload"]

          case phase
          when "user"
            txt = pl.is_a?(Hash) ? (pl["content"] || pl["text"] || "") : pl.to_s
            seq = pl.is_a?(Hash) && pl["call_seq"] ? pl["call_seq"].to_i : e["id"].to_i
            { ts: ts, seq: seq, order: 0, id: e["id"].to_i, body: "User: #{txt.to_s.gsub(/\s+/, ' ').strip}" }
          when "plan"
            plan_data = pl.is_a?(Hash) ? pl : {}
            plan_tool = plan_data["tool"] || plan_data[:tool]
            thought = plan_data["thought"] || plan_data[:thought]
            summary = plan_data["summary"] || plan_data[:summary]

            body = if plan_tool.to_s == "final"
                     txt = ((plan_data["args"] || plan_data[:args] || {})["content"]).to_s.gsub(/\s+/, " ").strip
                     "Agent: #{txt.empty? ? 'Task completed' : "#{txt[0, 200]}#{txt.length > 200 ? '...' : ''}"}"
                   elsif thought && !thought.to_s.strip.empty?
                     "Agent: #{thought.to_s.gsub(/\s+/, ' ').strip}"
                   elsif summary && !summary.to_s.strip.empty?
                     "Agent: #{summary.to_s.gsub(/\s+/, ' ').strip}"
                   else
                     "Agent: Calling #{plan_tool}"
                   end
            { ts: ts, seq: e["id"].to_i, order: 0, id: e["id"].to_i, body: body }
          when "execution"
            res = pl.is_a?(Hash) ? pl["result"] : nil
            status = extract_status(pl, res)
            body = extract_body(pl, res, tool)
            seq = pl.is_a?(Hash) && pl["call_seq"] ? pl["call_seq"].to_i : e["id"].to_i
            { ts: ts, seq: seq, order: 1, id: e["id"].to_i, body: "Tool #{tool}: #{status} - #{body.to_s.gsub(/\s+/, ' ').strip}" }
          end
        end

        def extract_status(pl, res)
          return "" unless pl.is_a?(Hash)

          res_status = res.is_a?(Hash) ? res["status"] : nil
          status = res_status || pl["status"]
          return status unless status.to_s.empty?

          success = res.is_a?(Hash) ? res["success"] : pl["success"]
          if success == true then "ok"
          elsif success == false then "failed"
          else ""
          end
        end

        def extract_body(pl, res, _tool)
          return pl.to_s unless pl.is_a?(Hash)

          candidates = []
          candidates.push(res["output"], res["content"], res["stdout"], res["stderr"], res["message"]) if res.is_a?(Hash)
          candidates.push(pl["output"], pl["content"], pl["stdout"], pl["stderr"], pl["message"])
          found = candidates.find { |v| v && !v.to_s.strip.empty? }
          found || (res ? res.to_json : pl.to_s)
        end

        def format_variables(vars)
          tool_status = {}
          tool_errors = {}
          other_vars = {}

          vars.each do |k, v|
            key = k.to_s
            if key.start_with?("tool_status:")
              tool_status[key.split(":", 2)[1]] = v
            elsif key.start_with?("tool_error:")
              tool_errors[key.split(":", 2)[1]] = v
            elsif key.start_with?("tool_mtime:")
              next
            else
              other_vars[key] = v
            end
          end

          lines = []
          if tool_status.any?
            lines << "Tool Status:"
            tool_status.keys.sort.each do |tool|
              err = tool_errors[tool]
              err_text = err && !err.to_s.strip.empty? ? " (error: #{err})" : ""
              lines << "- #{tool}: #{tool_status[tool]}#{err_text}"
            end
          end
          if other_vars.any?
            lines << "Variables:"
            other_vars.keys.sort.each do |key|
              val = other_vars[key].to_s
              val = "#{val[0, 10_000]} ... [truncated]" if val.length > 10_000
              lines << "- #{key}: #{val}"
            end
          end
          lines
        end

        def format_history_entries(ordered, threshold)
          last_ts = nil
          lines = ordered.map do |e|
            ts = e[:ts].to_i
            prefix = ""
            if ts.positive?
              show_time = last_ts.nil? || ((ts - last_ts).abs >= threshold)
              tstr = Time.at(ts).strftime("%H:%M:%S") rescue ts.to_s
              prefix = show_time ? "[#{tstr}] " : ""
              last_ts = ts
            end
            "- #{prefix}#{e[:body]}"
          end

          merged = []
          last = nil
          count = 0
          lines.each do |ln|
            if last && ln == last
              count += 1
            else
              merged << (count > 1 ? "#{last} (x#{count})" : last) if last
              last = ln
              count = 1
            end
          end
          merged << (count > 1 ? "#{last} (x#{count})" : last) if last
          merged
        end
      end
    end
  end
end
