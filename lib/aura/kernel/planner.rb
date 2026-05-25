# frozen_string_literal: true

require "aura"
require "aura/llm/client"
require "aura/llm/prompts/compose"
require "aura/llm/parsers/response_parser"
require "aura/llm/env"
require "aura/config_loader"

module Aura
  module Kernel
    class Planner
      attr_reader :client, :temp, :max_tokens

      def initialize(project_path, options = {})
        @project_path = File.expand_path(project_path)
        @env_path = options[:env_path] || Aura::PathResolver.environment_path(@project_path)
        cfg = load_config
        llm_cfg = cfg["llm"] || {}
        @temp = llm_cfg["temperature"]
        @max_tokens = llm_cfg["max_tokens"]
        @sum_suggest = cfg.dig("tool_protocol", "call_summary", "suggested_chars")
        @sum_max = cfg.dig("tool_protocol", "call_summary", "max_chars")

        @client = if defined?(Aura::LLM::Client) && Aura::LLM::Client.respond_to?(:from_config)
                    Aura::LLM::Client.from_config(llm_cfg, @project_path)
                  else
                    provider = llm_cfg["provider"] || "local"
                    api_base = llm_cfg["api_base"]
                    model = llm_cfg["model"]
                    Aura::LLM::Env.load_from(@project_path)
                    api_key = Aura::LLM::Env.resolve_api_key(provider)
                    Aura::LLM::Client.new(provider: provider, api_base: api_base, api_key: api_key, model: model)
                  end
      end

      def plan(context, goal = nil)
        messages, tools = Aura::LLM::Prompts::Compose.messages_and_tools(context, goal)

        options = { temperature: @temp, max_tokens: @max_tokens }
        options[:tools] = tools if tools && !tools.empty?

        out = @client.complete(messages, options)
        parsed = Aura::LLM::Parsers::ResponseParser.parse(out[:raw] || out[:content])

        # Validate parsed result
        validate_parsed_plan(parsed, out[:content])

        parsed[:finish_reason] = out[:finish_reason] if parsed.is_a?(Hash)

        parsed
      end

      def plan_stream(context, goal = nil)
        messages, tools = Aura::LLM::Prompts::Compose.messages_and_tools(context, goal)

        options = { temperature: @temp, max_tokens: @max_tokens }
        options[:tools] = tools if tools && !tools.empty?

        buf = +""
        res = @client.complete_stream(messages, options) do |delta|
          yield({ type: "delta", text: delta }) if block_given?
          buf << delta.to_s
          next unless buf.include?("}")

          parsed = Aura::LLM::Parsers::ResponseParser.parse(buf)
          if parsed[:type] == "tool_call"
            yield({ type: "plan", plan: parsed }) if block_given?
            return parsed
          end
        end

        parsed = Aura::LLM::Parsers::ResponseParser.parse(res[:raw] || res[:content] || buf)
        parsed[:finish_reason] = res[:finish_reason] if parsed.is_a?(Hash)
        yield({ type: "plan", plan: parsed }) if block_given?
        parsed
      end

      private
        def validate_parsed_plan(parsed, raw_body)
          if parsed[:type] == "tool_call"
            if parsed[:tool].to_s.strip.empty?
              puts "\e[33m⚠️ Warning: Parsed tool call missing tool name\e[0m"
              puts "   Raw: #{raw_body[0, 200]}..."
            end
            if !parsed[:args].is_a?(Hash)
              puts "\e[33m⚠️ Warning: Tool args is not a Hash: #{parsed[:args].class}\e[0m"
              puts "   Raw: #{raw_body[0, 200]}..."
            end
          elsif parsed[:type] == "text"
            puts "\e[33m⚠️ Warning: LLM returned text instead of JSON\e[0m"
            puts "   Raw: #{raw_body[0, 300]}..."
          end
        end
        
        def load_config
          Aura::ConfigLoader.load(@env_path, safe: true)
        end
    end
  end
end