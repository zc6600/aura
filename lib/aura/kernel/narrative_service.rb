# frozen_string_literal: true

require "aura/llm/client"
require "aura/llm/env"
require "json"

module Aura
  module Kernel
    class NarrativeService
      def initialize(project_path)
        @project_path = project_path
      end

      def synthesize(events)
        return "No events to summarize." if events.empty?

        # Load LLM config
        cfg = load_config
        provider = cfg.dig("llm", "provider") || "local"
        api_base = cfg.dig("llm", "api_base")
        model = cfg.dig("llm", "model")
        
        Aura::LLM::Env.load_from(@project_path)
        api_key = Aura::LLM::Env.resolve_api_key(provider)
        client = Aura::LLM::Client.new(provider: provider, api_base: api_base, api_key: api_key, model: model)

        prompt = compose_prompt(events)
        merged_prompt = <<~MSG.strip
          System Instructions: You are an expert technical summarizer. Your goal is to condense a series of tool execution events into a concise progress narrative for an AI agent.

          #{prompt}
        MSG
        messages = [
          { role: "user", content: merged_prompt }
        ]

        begin
          out = client.complete(messages, { temperature: 0.3, max_tokens: 500 })
          out[:content].strip
        rescue StandardError => e
          "Metabolism synthesis failed: #{e.message}. Cleared old events."
        end
      end

      private

      def load_config
        path = Aura::PathResolver.resolve_config_path(@project_path)
        return {} unless File.exist?(path)
        require "yaml"
        YAML.load_file(path) || {}
      rescue StandardError
        {}
      end

      def compose_prompt(events)
        event_str = events.map do |e|
          payload = e["payload"]
          tool = e["tool"]
          phase = e["phase"]
          "- [#{phase}] #{tool}: #{payload.to_json}"
        end.join("\n")

        <<~PROMPT
          Please synthesize the following tool execution history into a concise "Progress Narrative". 
          Focus on what was attempted, what the result was, and the current status.
          Keep it under 200 words.

          ### History:
          #{event_str}

          ### Focus on:
          - Key files modified
          - Critical test results
          - Any blockers encountered
          - The cumulative result of these steps
        PROMPT
      end
    end
  end
end
