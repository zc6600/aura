# frozen_string_literal: true

require "aura/llm/adapters/openai"

module Aura
  module LLM
    module Adapters
      class Gemini < OpenAI
        def initialize(api_base:, api_key:, model:)
          base = api_base.to_s.empty? ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" : api_base
          m = model.to_s.empty? ? "gemini-1.5-flash" : model
          super(api_base: base, api_key: api_key, model: m)
        end
      end
    end
  end
end
