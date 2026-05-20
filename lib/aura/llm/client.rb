module Aura
  module LLM
    class Client
      def initialize(provider:, api_base: nil, api_key: nil, model: nil)
        @provider = provider || "local"
        @api_base = api_base
        @api_key = api_key
        @model = model
      end

      def complete(messages, options = {})
        adapter = build_adapter
        adapter.complete(messages, options)
      end

      def complete_stream(messages, options = {})
        adapter = build_adapter
        if adapter.respond_to?(:complete_stream)
          adapter.complete_stream(messages, options) { |delta| yield(delta) if block_given? }
        else
          out = adapter.complete(messages, options)
          s = out[:content].to_s
          if block_given?
            s.each_char { |ch| yield(ch) }
          end
          out
        end
      end

      private
        def build_adapter
          case @provider
          when "local"
            require "aura/llm/adapters/local"
            Aura::LLM::Adapters::Local.new
          when "openrouter"
            require "aura/llm/adapters/openrouter"
            Aura::LLM::Adapters::OpenRouter.new(api_base: @api_base, api_key: @api_key, model: @model)
          when "openai"
            require "aura/llm/adapters/openai"
            Aura::LLM::Adapters::OpenAI.new(api_base: @api_base, api_key: @api_key, model: @model)
          when "deepseek"
            require "aura/llm/adapters/deepseek"
            Aura::LLM::Adapters::DeepSeek.new(api_base: @api_base, api_key: @api_key, model: @model)
          when "gemini"
            require "aura/llm/adapters/gemini"
            Aura::LLM::Adapters::Gemini.new(api_base: @api_base, api_key: @api_key, model: @model)
          when "anthropic"
            require "aura/llm/adapters/anthropic"
            Aura::LLM::Adapters::Anthropic.new(api_base: @api_base, api_key: @api_key, model: @model)
          else
            require "aura/llm/adapters/local"
            Aura::LLM::Adapters::Local.new
          end
        end
    end
  end
end
