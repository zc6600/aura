require "net/http"
require "json"

module Aura
  module LLM
    module Adapters
      class OpenRouter
        def initialize(api_base:, api_key:, model:)
          @api_base = api_base.to_s.empty? ? "https://openrouter.ai/api/v1/chat/completions" : api_base
          @api_key = api_key
          @model = model || "openai/gpt-4o-mini"
        end

      def supports_native_tools?
        true
      end

      def complete(messages, options = {})
        raise "Missing OPENROUTER_API_KEY" if @api_key.to_s.empty?
        uri = URI(@api_base)
        req = Net::HTTP::Post.new(uri)
        req["Authorization"] = "Bearer #{@api_key}"
        req["Content-Type"] = "application/json"
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

        req.body = JSON.dump(body)
        http_opts = { use_ssl: uri.scheme == "https" }
        res = Net::HTTP.start(uri.host, uri.port, http_opts) { |http| http.request(req) }
        json = JSON.parse(res.body) rescue {}
        content = json.dig("choices", 0, "message", "content") || ""
        finish_reason = json.dig("choices", 0, "finish_reason")
        { content: content, raw: json, finish_reason: finish_reason }
      rescue => e
        { content: e.message, error: e.message }
      end

      def complete_stream(messages, options = {})
        raise "Missing OPENROUTER_API_KEY" if @api_key.to_s.empty?
        uri = URI(@api_base)
        req = Net::HTTP::Post.new(uri)
        req["Authorization"] = "Bearer #{@api_key}"
        req["Content-Type"] = "application/json"
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

        req.body = JSON.dump(body)
        http_opts = { use_ssl: uri.scheme == "https" }
        total = ""
        buffer = +""
        tool_calls = []
        finish_reason = nil
        Net::HTTP.start(uri.host, uri.port, http_opts) do |http|
          http.request(req) do |res|
            res.read_body do |chunk|
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
                  if fr
                    finish_reason = fr
                  end

                  tcs = json.dig("choices", 0, "delta", "tool_calls")
                  if tcs.is_a?(Array)
                    tcs.each do |tc|
                      idx = tc["index"] || 0
                      tool_calls[idx] ||= { "function" => { "name" => +"", "arguments" => +"" } }
                      if tc["id"]
                        tool_calls[idx]["id"] = tc["id"]
                      end
                      if tc["function"]
                        if tc["function"]["name"]
                          tool_calls[idx]["function"]["name"] << tc["function"]["name"]
                        end
                        if tc["function"]["arguments"]
                          tool_calls[idx]["function"]["arguments"] << tc["function"]["arguments"]
                        end
                      end
                    end
                  end
                rescue
                end
              end
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
      rescue => e
        { content: "", error: e.message }
      end
      end
    end
  end
end
