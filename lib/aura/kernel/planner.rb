require "aura"
require "aura/llm/client"
require "aura/llm/prompts/compose"
require "aura/llm/parsers/response_parser"
require "aura/llm/env"

module Aura
  module Kernel
    class Planner
      def initialize(project_path, options = {})
        @project_path = File.expand_path(project_path)
        @env_path = options[:env_path] || Aura.environment_path(@project_path)
        cfg = load_config
        provider = cfg.dig("llm", "provider") || "local"
        api_base = cfg.dig("llm", "api_base")
        model = cfg.dig("llm", "model")
        @temp = cfg.dig("llm", "temperature")
        @max_tokens = cfg.dig("llm", "max_tokens")
        @sum_suggest = cfg.dig("tool_protocol", "call_summary", "suggested_chars")
        @sum_max = cfg.dig("tool_protocol", "call_summary", "max_chars")
        Aura::LLM::Env.load_from(@project_path)
        api_key = Aura::LLM::Env.resolve_api_key(provider)
        @client = Aura::LLM::Client.new(provider: provider, api_base: api_base, api_key: api_key, model: model)
      end

      def plan(context, goal = nil)
        messages = Aura::LLM::Prompts::Compose.messages(context, goal, { suggested_chars: @sum_suggest, max_chars: @sum_max })
        out = @client.complete(messages, { temperature: @temp, max_tokens: @max_tokens })
        body = out[:content]
        parsed = Aura::LLM::Parsers::ResponseParser.parse(body)
        
        # Validate parsed result
        validate_parsed_plan(parsed, body)
        
        parsed
      end

      def plan_stream(context, goal = nil)
        messages = Aura::LLM::Prompts::Compose.messages(context, goal, { suggested_chars: @sum_suggest, max_chars: @sum_max })
        buf = ""

        @client.complete_stream(messages, { temperature: @temp, max_tokens: @max_tokens }) do |delta|
          yield({ type: "delta", text: delta }) if block_given?
          buf << delta.to_s
          next unless buf.include?("}")

          parsed = Aura::LLM::Parsers::ResponseParser.parse(buf)
          if parsed[:type] == "tool_call"
            yield({ type: "plan", plan: parsed }) if block_given?
            return parsed
          end
        end

        parsed = Aura::LLM::Parsers::ResponseParser.parse(buf)
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
          begin
            require "yaml"
            path = File.join(@env_path, "config", "config.yml")
            File.exist?(path) ? Aura.safe_load_yaml(path) : {}
          rescue StandardError
            {}
          end
        end
    end
  end
end
