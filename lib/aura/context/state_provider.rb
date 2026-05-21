# frozen_string_literal: true

require "json"

module Aura
  module Context
    class StateProvider
      def initialize(db, options = {})
        @db = db
        @options = options
      end

      def provide
        return nil unless @db
        section = ["# AGENT STATE & MEMORY"]
        history_entries = []
        fallback_seq = 0
        if @db.respond_to?(:get_recent_summaries_structured)
          summaries = @db.get_recent_summaries_structured || []
          summaries.each do |s|
            content = s["content"] || s[:content]
            next if content.to_s.strip.empty?
            ts = (s["timestamp"] || s[:timestamp]).to_i
            source_event_id = s["source_event_id"] || s[:source_event_id] || s["event_id"] || s[:event_id]
            seq = source_event_id || (s["id"] || s[:id])
            body = content.to_s.gsub(/\s+/, " ").strip
            history_entries << { ts: ts, seq: seq.to_i, order: 2, id: (s["id"] || s[:id]).to_i, body: "Summary: #{body}" }
          end
        elsif @db.respond_to?(:get_recent_summaries)
          summaries = @db.get_recent_summaries
          summaries.to_s.split("\n").each do |line|
            body = line.to_s.gsub(/\s+/, " ").strip
            next if body.empty?
            fallback_seq += 1
            history_entries << { ts: 0, seq: fallback_seq, order: 2, id: 0, body: "Summary: #{body}" }
          end
        elsif @db.respond_to?(:get_latest_summary)
          summary = @db.get_latest_summary
          summary.to_s.split("\n").each do |line|
            body = line.to_s.gsub(/\s+/, " ").strip
            next if body.empty?
            fallback_seq += 1
            history_entries << { ts: 0, seq: fallback_seq, order: 2, id: 0, body: "Summary: #{body}" }
          end
        end
        if @db.respond_to?(:get_active_variables)
          vars = @db.get_active_variables || {}
          unless vars.empty?
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
                if val.length > 10000
                  val = val[0, 10000] + " ... [truncated]"
                end
                lines << "- #{key}: #{val}"
              end
            end
            section << "### Active Variables:\n#{lines.join("\n")}" unless lines.empty?
          end
        end
        threshold = 60
        begin
          if @db.respond_to?(:read_config, true)
            cfg = @db.send(:read_config) || {}
            cc = (cfg["context_compression"] || {})
            gap = cc["event_time_gap_seconds"]
            v = gap.to_i if gap
            threshold = v if v && v > 0
          end
        rescue StandardError
        end
        if @db.respond_to?(:get_recent_events_structured, true)
          # Include "plan" phase to show agent's responses in history
          items = @db.send(:get_recent_events_structured, phases: ["user", "plan", "execution"]) || []
          if items.any?
            items.each do |e|
              ts = e["timestamp"]
              phase = e["phase"].to_s
              tool = e["tool"]
              pl = e["payload"]
              if phase == "user"
                txt = pl.is_a?(Hash) ? (pl["content"] || pl["text"] || "") : pl.to_s
                txt = txt.to_s.gsub(/\s+/, " ").strip
                body = "User: #{txt}"
                seq = if pl.is_a?(Hash) && pl["call_seq"]
                  pl["call_seq"].to_i
                else
                  e["id"].to_i
                end
                history_entries << { ts: ts.to_i, seq: seq, order: 0, id: e["id"].to_i, body: body }
              elsif phase == "plan"
                # Show agent's tool call summary or plan
                plan_data = pl.is_a?(Hash) ? pl : {}
                plan_tool = plan_data["tool"] || plan_data[:tool]
                summary = plan_data["summary"] || plan_data[:summary]
                thought = plan_data["thought"] || plan_data[:thought]
                if plan_tool.to_s == "final"
                  # For final answers, show the content
                  final_content = (plan_data["args"] || plan_data[:args] || {})["content"]
                  txt = final_content.to_s.gsub(/\s+/, " ").strip
                  txt = txt[0, 200] + "..." if txt.length > 200
                  body = "Agent: #{txt.empty? ? 'Task completed' : txt}"
                else
                  # For tool calls, show thought (reasoning) if present, otherwise summary or tool name
                  body = if thought && !thought.to_s.strip.empty?
                    "Agent: #{thought.to_s.gsub(/\s+/, " ").strip}"
                  elsif summary && !summary.to_s.strip.empty?
                    "Agent: #{summary.to_s.gsub(/\s+/, " ").strip}"
                  else
                    "Agent: Calling #{plan_tool}"
                  end
                end
                seq = e["id"].to_i
                history_entries << { ts: ts.to_i, seq: seq, order: 0, id: e["id"].to_i, body: body }
              elsif phase == "execution"
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
                history_entries << { ts: ts.to_i, seq: seq, order: 1, id: e["id"].to_i, body: body }
              else
                txt = pl.is_a?(Hash) ? (pl["content"] || pl["text"] || pl.to_json) : pl.to_s
                txt = txt.to_s.gsub(/\s+/, " ").strip
                body = "#{phase}: #{txt}"
                history_entries << { ts: ts.to_i, seq: e["id"].to_i, order: 3, id: e["id"].to_i, body: body }
              end
            end
          end
        elsif @db.respond_to?(:get_recent_events)
          recent = @db.get_recent_events
          if recent && !recent.to_s.empty?
            recent.to_s.split("\n").each do |line|
              body = line.to_s.gsub(/\s+/, " ").strip
              next if body.empty?
              fallback_seq += 1
              history_entries << { ts: 0, seq: fallback_seq, order: 2, id: 0, body: body }
            end
          end
        end
        if history_entries.any?
          ordered = history_entries.sort_by { |e| [e[:seq].to_i, e[:order].to_i, e[:id].to_i] }
          last_ts = nil
          lines = ordered.map do |e|
            ts = e[:ts].to_i
            prefix = ""
            if ts > 0
              # Show timestamp if it's the first event or if gap is significant (threshold seconds)
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
              if last
                merged << (count > 1 ? "#{last} (x#{count})" : last)
              end
              last = ln
              count = 1
            end
          end
          merged << (count > 1 ? "#{last} (x#{count})" : last) if last
          section << "### History:\n#{merged.join("\n")}"
        end
        section.join("\n")
      end
    end
  end
end
