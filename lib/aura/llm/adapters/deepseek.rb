# frozen_string_literal: true

require "aura/llm/adapters/openai"

module Aura
  module LLM
    module Adapters
      class DeepSeek < OpenAI
        def initialize(api_base:, api_key:, model:)
          base = api_base.to_s.empty? ? "https://api.deepseek.com/v1/chat/completions" : api_base
          m = model.to_s.empty? ? "deepseek-chat" : model
          super(api_base: base, api_key: api_key, model: m)
        end
      end
    end
  end
end
