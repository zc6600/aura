# frozen_string_literal: true

require "json"
require "aura/llm/http_client"

module Aura
  module LLM
    module Adapters
      class OpenAI
        def initialize(api_base:, api_key:, model:)
          @api_base = api_base.to_s.empty? ? "https://api.openai.com/v1/chat/completions" : api_base
          @api_key = api_key
          @model = model || "gpt-4o-mini"
        end

        def supports_native_tools?
          true
        end

        def complete(messages, options = {})
          raise Aura::LLMAuthError, "Missing OPENAI_API_KEY" if @api_key.to_s.empty?
          headers = {
            "Authorization" => "Bearer #{@api_key}",
            "Content-Type" => "application/json"
          }
          body = {
            model: @model,
            messages: messages,
            temperature: options[:temperature],
            max_tokens: options[:max_tokens]
          }.delete_if { |_, v| v.nil? }

          if options[:tools] && !options[:tools].empty?
            body[:tools] = options[:tools]
            body[:tool_choice] = "auto"
          end

          json = HttpClient.post(@api_base, headers, body)
          content = json.dig("choices", 0, "message", "content") || ""
          finish_reason = json.dig("choices", 0, "finish_reason")
          { content: content, raw: json, finish_reason: finish_reason }
        end

        def complete_stream(messages, options = {})
          raise Aura::LLMAuthError, "Missing OPENAI_API_KEY" if @api_key.to_s.empty?
          headers = {
            "Authorization" => "Bearer #{@api_key}",
            "Content-Type" => "application/json"
          }
          body = {
            model: @model,
            messages: messages,
            temperature: options[:temperature],
            max_tokens: options[:max_tokens],
            stream: true
          }.delete_if { |_, v| v.nil? }

          if options[:tools] && !options[:tools].empty?
            body[:tools] = options[:tools]
            body[:tool_choice] = "auto"
          end

          total = +""
          buffer = +""
          tool_calls = []
          finish_reason = nil

          HttpClient.post(@api_base, headers, body, stream: true) do |chunk|
            buffer << chunk.to_s
            while (idx = buffer.index("\n"))
              line = buffer.slice!(0, idx + 1).to_s.chomp
              next unless line.start_with?("data: ")
              data = line[6..-1].to_s.strip
              next if data.empty? || data == "[DONE]"
              begin
                json = JSON.parse(data)
                delta = json.dig("choices", 0, "delta", "content")
                if delta && !delta.empty?
                  yield(delta) if block_given?
                  total << delta
                end

                fr = json.dig("choices", 0, "finish_reason")
                finish_reason = fr if fr

                tcs = json.dig("choices", 0, "delta", "tool_calls")
                if tcs.is_a?(Array)
                  tcs.each do |tc|
                    index = tc["index"] || 0
                    tool_calls[index] ||= { "function" => { "name" => +"", "arguments" => +"" } }
                    tool_calls[index]["id"] = tc["id"] if tc["id"]
                    if tc["function"]
                      tool_calls[index]["function"]["name"] << tc["function"]["name"] if tc["function"]["name"]
                      tool_calls[index]["function"]["arguments"] << tc["function"]["arguments"] if tc["function"]["arguments"]
                    end
                  end
                end
              rescue
                # Ignore JSON parse errors for incomplete/partial stream lines
              end
            end
          end

          if tool_calls.any?
            raw_response = {
              "choices" => [
                {
                  "message" => {
                    "role" => "assistant",
                    "content" => total,
                    "tool_calls" => tool_calls
                  },
                  "finish_reason" => finish_reason
                }
              ]
            }
            { content: total, raw: raw_response, finish_reason: finish_reason }
          else
            { content: total, finish_reason: finish_reason }
          end
        end
      end
    end
  end
end
