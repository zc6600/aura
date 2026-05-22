# frozen_string_literal: true

require "json"

module Aura
  module LLM
    module Parsers
      class ResponseParser
        def self.parse(output)
          begin
            raw = output.is_a?(String) ? output.to_s : output.to_s
            obj = output.is_a?(String) ? (safe_json_parse(raw) || raw) : output
            if obj.is_a?(Hash)
              if obj["tool"]
                return { type: "tool_call", tool: obj["tool"], args: normalize_args(obj["args"]), summary: obj["summary"] }
              end

              tc = obj["tool_calls"]
              if tc.is_a?(Array) && tc.any?
                call = tc.first || {}
                tool = call["tool"] || call["name"] || (call["function"] && call["function"]["name"])
                args = call["args"] || call["arguments"] || call["input"] || (call["function"] && call["function"]["arguments"]) || {}
                args = normalize_args(args)
                summary = obj["summary"] || call["summary"] || (args.is_a?(Hash) ? args.delete("summary") : nil)
                # If there is a content field in the main object, it's the thought
                thought = obj["content"] || obj["message"] && obj["message"]["content"]
                return { type: "tool_call", tool: tool, args: args || {}, summary: summary, thought: thought }
              end

              nested = obj.dig("choices", 0, "message", "tool_calls")
              if nested.is_a?(Array) && nested.any?
                call = nested.first || {}
                tool = call["tool"] || call["name"] || (call["function"] && call["function"]["name"])
                args = call["args"] || call["arguments"] || call["input"] || (call["function"] && call["function"]["arguments"]) || {}
                args = normalize_args(args)
                summary = obj["summary"] || call["summary"] || (args.is_a?(Hash) ? args.delete("summary") : nil)
                # The content is usually in message.content
                thought = obj.dig("choices", 0, "message", "content")
                return { type: "tool_call", tool: tool, args: args || {}, summary: summary, thought: thought }
              end
            end
            { type: "text", content: output.to_s }
          rescue StandardError
            { type: "text", content: output.to_s }
          end
        end

        def self.safe_json_parse(s)
          begin
            JSON.parse(s)
          rescue StandardError
            blk = extract_json_block(s)
            blk ? JSON.parse(blk) : nil
          end
        end

        def self.extract_json_block(s)
          if s.include?("```")
            a = s.gsub(/^\s*```json\s*/m, "").gsub(/^\s*```\s*/m, "")
            b = a.gsub(/\s*```\s*$/m, "")
            return b.strip if b.strip.start_with?("{")
          end
          start = s.index("{")
          endi = s.rindex("}")
          if start && endi && endi > start
            return s[start..endi]
          end
          nil
        end

        def self.normalize_args(args)
          if args.nil?
            {}
          elsif args.is_a?(String)
            begin
              parsed = JSON.parse(args)
              parsed.is_a?(Hash) ? parsed : { "value" => parsed }
            rescue StandardError
              { "value" => args }
            end
          elsif args.is_a?(Hash)
            out = args.dup
            out.delete("summary")
            out
          else
            args
          end
        end
      end
    end
  end
end
