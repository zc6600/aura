# frozen_string_literal: true

module Aura
  module Memory
    class Provider
      def initialize(store)
        @store = store
      end

      def recent_events(limit: nil, phases: nil, tools: nil)
        @store.fetch_events(limit: limit, phases: phases, tools: tools)
      end

      def old_events(keep_recent: 20)
        total = @store.count_events
        return [] if total <= keep_recent

        offset = [keep_recent - 1, 0].max
        @store.fetch_events(offset: offset)
      end

      def recent_summaries(limit: nil)
        @store.fetch_summaries(limit: limit)
      end

      def active_variables
        @store.all_variables
      end

      def assemble_context(include: [:events, :summaries, :variables], options: {})
        context = {}
        context[:events] = recent_events(limit: options[:event_limit], phases: options[:phases]) if include.include?(:events)
        context[:summaries] = recent_summaries(limit: options[:summary_limit]) if include.include?(:summaries)
        context[:variables] = active_variables if include.include?(:variables)
        context
      end

      def to_markdown(options: {})
        section = ["# AGENT STATE & MEMORY"]
        history_entries = []
        fallback_seq = 0

        summaries = recent_summaries(limit: options[:summary_limit])
        summaries.each do |s|
          content = s["content"]
          next if content.to_s.strip.empty?

          ts = s["timestamp"].to_i
          source_event_id = s["source_event_id"] || s["id"]
          seq = source_event_id || s["id"]
          body = content.to_s.gsub(/\s+/, " ").strip
          history_entries << { ts: ts, seq: seq.to_i, order: 2, id: s["id"].to_i, body: "Summary: #{body}" }
        end

        vars = active_variables
        unless vars.empty?
          lines = format_variables(vars)
          section << "### Active Variables:\n#{lines.join("\n")}" unless lines.empty?
        end

        items = recent_events(limit: options[:event_limit], phases: ["user", "plan", "execution"])
        if items.any?
          items.each do |e|
            entry = format_event(e)
            history_entries << entry if entry
          end
        end

        if history_entries.any?
          ordered = history_entries.sort_by { |e| [e[:seq].to_i, e[:order].to_i, e[:id].to_i] }
          lines = format_history_entries(ordered, options[:event_time_gap_seconds] || 60)
          section << "### History:\n#{lines.join("\n")}"
        end

        section.join("\n")
      end

      private

      def format_variables(vars)
        tool_status = {}
        tool_errors = {}
        other_vars = {}

        vars.each do |k, v|
          key = k.to_s
          if key.start_with?("tool_status:")
            tool = key.split(":", 2)[1]
            tool_status[tool] = v
          elsif key.start_with?("tool_error:")
            tool = key.split(":", 2)[1]
            tool_errors[tool] = v
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
            st = tool_status[tool]
            err = tool_errors[tool]
            err_text = err && !err.to_s.strip.empty? ? " (error: #{err})" : ""
            lines << "- #{tool}: #{st}#{err_text}"
          end
        end
        if other_vars.any?
          lines << "Variables:"
          other_vars.keys.sort.each do |key|
            val = other_vars[key].to_s
            val = val[0, 10000] + " ... [truncated]" if val.length > 10000
            lines << "- #{key}: #{val}"
          end
        end
        lines
      end

      def format_event(e)
        ts = e["timestamp"]
        phase = e["phase"].to_s
        tool = e["tool"]
        pl = e["payload"]

        case phase
        when "user"
          txt = pl.is_a?(Hash) ? (pl["content"] || pl["text"] || "") : pl.to_s
          txt = txt.to_s.gsub(/\s+/, " ").strip
          body = "User: #{txt}"
          seq = if pl.is_a?(Hash) && pl["call_seq"]
                  pl["call_seq"].to_i
                else
                  e["id"].to_i
                end
          { ts: ts.to_i, seq: seq, order: 0, id: e["id"].to_i, body: body }
        when "plan"
          plan_data = pl.is_a?(Hash) ? pl : {}
          plan_tool = plan_data["tool"] || plan_data[:tool]
          summary = plan_data["summary"] || plan_data[:summary]
          thought = plan_data["thought"] || plan_data[:thought]

          if plan_tool.to_s == "final"
            final_content = (plan_data["args"] || plan_data[:args] || {})["content"]
            txt = final_content.to_s.gsub(/\s+/, " ").strip
            txt = txt[0, 200] + "..." if txt.length > 200
            body = "Agent: #{txt.empty? ? 'Task completed' : txt}"
          else
            body = if thought && !thought.to_s.strip.empty?
                     "Agent: #{thought.to_s.gsub(/\s+/, " ").strip}"
                   elsif summary && !summary.to_s.strip.empty?
                     "Agent: #{summary.to_s.gsub(/\s+/, " ").strip}"
                   else
                     "Agent: Calling #{plan_tool}"
                   end
          end
          { ts: ts.to_i, seq: e["id"].to_i, order: 0, id: e["id"].to_i, body: body }
        when "execution"
          res = pl.is_a?(Hash) ? pl["result"] : nil
          status = ""
          if pl.is_a?(Hash)
            res_status = res.is_a?(Hash) ? res["status"] : nil
            res_success = res.is_a?(Hash) ? res["success"] : nil
            top_status = pl["status"]
            top_success = pl["success"]
            status = res_status || top_status
            if status.to_s.empty?
              success = res_success.nil? ? top_success : res_success
              status = success == true ? "ok" : (success == false ? "failed" : "")
            end
          end

          body = if pl.is_a?(Hash)
                   candidates = []
                   if res.is_a?(Hash)
                     candidates.concat([res["output"], res["content"], res["stdout"], res["stderr"], res["message"]])
                   end
                   candidates.concat([pl["output"], pl["content"], pl["stdout"], pl["stderr"], pl["message"]])
                   found = candidates.find { |v| v && !v.to_s.strip.empty? }
                   if found && !found.to_s.strip.empty?
                     found
                   else
                     res ? res.to_json : pl.to_s
                   end
                 else
                   pl.to_s
                 end
          body = body.to_s.gsub(/\s+/, " ").strip
          body = "Tool #{tool}: #{status} - #{body}"
          seq = if pl.is_a?(Hash) && pl["call_seq"]
                  pl["call_seq"].to_i
                else
                  e["id"].to_i
                end
          { ts: ts.to_i, seq: seq, order: 1, id: e["id"].to_i, body: body }
        end
      end

      def format_history_entries(ordered, threshold)
        last_ts = nil
        lines = ordered.map do |e|
          ts = e[:ts].to_i
          prefix = ""
          if ts > 0
            show_time = last_ts.nil? || ((ts - last_ts).abs >= threshold)
            tstr = begin Time.at(ts).strftime("%H:%M:%S") rescue ts.to_s end
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
