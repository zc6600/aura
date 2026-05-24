# frozen_string_literal: true

module Aura
  module LLM
    class Client
      @adapters = {}

      # Class-level registry methods
      def self.register_adapter(provider_name, klass)
        @adapters[provider_name.to_s] = klass
      end

      def self.adapters
        @adapters
      end

      def initialize(provider:, api_base: nil, api_key: nil, model: nil)
        @provider = provider || "local"
        @api_base = api_base
        @api_key = api_key
        @model = model
        @adapter = build_adapter
      end

      def complete(messages, options = {})
        @adapter.complete(messages, options)
      end

      def complete_stream(messages, options = {})
        if @adapter.respond_to?(:complete_stream)
          @adapter.complete_stream(messages, options) { |delta| yield(delta) if block_given? }
        else
          out = @adapter.complete(messages, options)
          s = out[:content].to_s
          if block_given?
            s.each_char { |ch| yield(ch) }
          end
          out
        end
      end

      def supports_native_tools?
        @adapter.respond_to?(:supports_native_tools?) && @adapter.supports_native_tools?
      end

      private

      def build_adapter
        klass = self.class.adapters[@provider.to_s]
        
        if klass.nil?
          # Fallback to local
          require "aura/llm/adapters/local"
          Aura::LLM::Adapters::Local.new
        else
          # Dynamically instantiate the registered adapter class
          klass.new(api_base: @api_base, api_key: @api_key, model: @model)
        end
      end
    end
  end
end

# Register default core adapters
require "aura/llm/adapters/local"
Aura::LLM::Client.register_adapter("local", Aura::LLM::Adapters::Local)

require "aura/llm/adapters/openrouter"
Aura::LLM::Client.register_adapter("openrouter", Aura::LLM::Adapters::OpenRouter)

require "aura/llm/adapters/openai"
Aura::LLM::Client.register_adapter("openai", Aura::LLM::Adapters::OpenAI)

require "aura/llm/adapters/deepseek"
Aura::LLM::Client.register_adapter("deepseek", Aura::LLM::Adapters::DeepSeek)

require "aura/llm/adapters/gemini"
Aura::LLM::Client.register_adapter("gemini", Aura::LLM::Adapters::Gemini)

require "aura/llm/adapters/anthropic"
Aura::LLM::Client.register_adapter("anthropic", Aura::LLM::Adapters::Anthropic)
