# frozen_string_literal: true

require "net/http"
require "json"

module Aura
  module LLM
    module Adapters
      class Anthropic
        def initialize(api_base:, api_key:, model:)
          @api_base = api_base.to_s.empty? ? "https://api.anthropic.com/v1/messages" : api_base
          @api_key = api_key
          @model = model || "claude-3-5-sonnet-20241022"
        end

        def complete(messages, options = {})
          raise "Missing ANTHROPIC_API_KEY" if @api_key.to_s.empty?
          uri = URI(@api_base)
          req = Net::HTTP::Post.new(uri)
          req["x-api-key"] = @api_key
          req["anthropic-version"] = "2023-06-01"
          req["Content-Type"] = "application/json"

          system_prompt, cleaned_msgs = extract_system_and_messages(messages)

          body = {
            model: @model,
            messages: cleaned_msgs,
            temperature: options[:temperature],
            max_tokens: options[:max_tokens] || 4096
          }
          body[:system] = system_prompt if system_prompt
          body.delete_if { |_, v| v.nil? }
          
          req.body = JSON.dump(body)
          http_opts = { use_ssl: uri.scheme == "https" }
          res = Net::HTTP.start(uri.host, uri.port, http_opts) { |http| http.request(req) }
          json = JSON.parse(res.body) rescue {}
          content = json.dig("content", 0, "text") || ""
          { content: content, raw: json }
        rescue => e
          { content: "", error: e.message }
        end

        def complete_stream(messages, options = {})
          raise "Missing ANTHROPIC_API_KEY" if @api_key.to_s.empty?
          uri = URI(@api_base)
          req = Net::HTTP::Post.new(uri)
          req["x-api-key"] = @api_key
          req["anthropic-version"] = "2023-06-01"
          req["Content-Type"] = "application/json"

          system_prompt, cleaned_msgs = extract_system_and_messages(messages)

          body = {
            model: @model,
            messages: cleaned_msgs,
            temperature: options[:temperature],
            max_tokens: options[:max_tokens] || 4096,
            stream: true
          }
          body[:system] = system_prompt if system_prompt
          body.delete_if { |_, v| v.nil? }

          req.body = JSON.dump(body)
          http_opts = { use_ssl: uri.scheme == "https" }
          total = +""
          buffer = +""
          Net::HTTP.start(uri.host, uri.port, http_opts) do |http|
            http.request(req) do |res|
              res.read_body do |chunk|
                buffer << chunk.to_s
                while (idx = buffer.index("\n"))
                  line = buffer.slice!(0, idx + 1).to_s.chomp
                  next unless line.start_with?("data: ")
                  data = line[6..-1].to_s.strip
                  next if data.empty?
                  begin
                    json = JSON.parse(data)
                    next unless json["type"] == "content_block_delta"
                    delta = json.dig("delta", "text")
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

        private

        def extract_system_and_messages(messages)
          system_prompt = nil
          cleaned_messages = []
          messages.each do |msg|
            role = msg[:role] || msg["role"]
            content = msg[:content] || msg["content"]
            if role.to_s == "system"
              system_prompt = content
            else
              cleaned_messages << { role: role.to_s, content: content.to_s }
            end
          end
          [system_prompt, cleaned_messages]
        end
      end
    end
  end
end
