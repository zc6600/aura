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
        req.body = JSON.dump(body)
        http_opts = { use_ssl: uri.scheme == "https" }
        res = Net::HTTP.start(uri.host, uri.port, http_opts) { |http| http.request(req) }
        json = JSON.parse(res.body) rescue {}
        content = json.dig("choices", 0, "message", "content") || ""
        { content: content, raw: json }
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
        req.body = JSON.dump(body)
        http_opts = { use_ssl: uri.scheme == "https" }
        total = ""
        buffer = +""
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
                rescue
                end
              end
            end
          end
        end
        { content: total }
      rescue => e
        { content: "", error: e.message }
      end
      end
    end
  end
end
