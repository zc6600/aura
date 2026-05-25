# frozen_string_literal: true

require "json"
require "aura/llm/http_client"

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
          raise Aura::LLMAuthError, "Missing ANTHROPIC_API_KEY" if @api_key.to_s.empty?

          headers = {
            "x-api-key" => @api_key,
            "anthropic-version" => "2023-06-01",
            "Content-Type" => "application/json"
          }

          system_prompt, cleaned_msgs = extract_system_and_messages(messages)

          body = {
            model: @model,
            messages: cleaned_msgs,
            temperature: options[:temperature],
            max_tokens: options[:max_tokens] || 4096
          }
          body[:system] = system_prompt if system_prompt
          body.delete_if { |_, v| v.nil? }

          json = HttpClient.post(@api_base, headers, body)
          content = json.dig("content", 0, "text") || ""
          stop_reason = json["stop_reason"]
          { content: content, raw: json, finish_reason: stop_reason }
        end

        def complete_stream(messages, options = {})
          raise Aura::LLMAuthError, "Missing ANTHROPIC_API_KEY" if @api_key.to_s.empty?

          headers = {
            "x-api-key" => @api_key,
            "anthropic-version" => "2023-06-01",
            "Content-Type" => "application/json"
          }

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

          total = +""
          buffer = +""
          stop_reason = nil

          HttpClient.post(@api_base, headers, body, stream: true) do |chunk|
            buffer << chunk.to_s
            while (idx = buffer.index("\n"))
              line = buffer.slice!(0, idx + 1).to_s.chomp
              next unless line.start_with?("data: ")

              data = line[6..].to_s.strip
              next if data.empty?

              begin
                json = JSON.parse(data)
                if json["type"] == "content_block_delta"
                  delta = json.dig("delta", "text")
                  if delta && !delta.empty?
                    yield(delta) if block_given?
                    total << delta
                  end
                elsif json["type"] == "message_delta"
                  sr = json.dig("delta", "stop_reason")
                  stop_reason = sr if sr
                end
              rescue StandardError
                # Ignore JSON parse errors for incomplete/partial stream lines
              end
            end
          end
          { content: total, finish_reason: stop_reason }
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
