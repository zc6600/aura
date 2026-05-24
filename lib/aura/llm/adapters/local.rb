module Aura
  module LLM
    module Adapters
      class Local
        def initialize(api_base: nil, api_key: nil, model: nil)
        end

        def complete(messages, options = {})
          raise RuntimeError, "⛔️ Error: The default 'local' provider is an offline mock adapter. Please configure a real LLM provider (e.g. 'openai' or 'openrouter') by setting your API key in the environment (e.g. export OPENAI_API_KEY=...) and configuring llm.provider in config.yml."
        end

        def complete_stream(messages, options = {})
          raise RuntimeError, "⛔️ Error: The default 'local' provider is an offline mock adapter. Please configure a real LLM provider (e.g. 'openai' or 'openrouter') by setting your API key in the environment (e.g. export OPENAI_API_KEY=...) and configuring llm.provider in config.yml."
        end
      end
    end
  end
end
