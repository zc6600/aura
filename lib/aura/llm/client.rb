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

      attr_accessor :fallbacks, :max_retries

      def self.from_config(config, project_path = nil)
        return new(provider: "local") if config.nil?

        # Ensure ENV is loaded if project_path is provided
        if project_path
          require "aura/llm/env"
          Aura::LLM::Env.load_from(project_path)
        end

        provider = config["provider"] || config[:provider] || "local"
        
        # Resolve primary api_key
        api_key = config["api_key"] || config[:api_key]
        api_key_env = config["api_key_env"] || config[:api_key_env]
        api_key ||= ENV[api_key_env] if api_key_env
        api_key ||= Aura::LLM::Env.resolve_api_key(provider) unless provider.to_s.empty?

        # Resolve fallbacks
        fallbacks = []
        raw_fallbacks = config["fallbacks"] || config[:fallbacks] || []
        Array(raw_fallbacks).each do |fb|
          fb_provider = fb["provider"] || fb[:provider]
          next if fb_provider.nil? || fb_provider.to_s.strip.empty?
          
          fb_key = fb["api_key"] || fb[:api_key]
          fb_key_env = fb["api_key_env"] || fb[:api_key_env]
          fb_key ||= ENV[fb_key_env] if fb_key_env
          fb_key ||= Aura::LLM::Env.resolve_api_key(fb_provider)
          
          fallbacks << {
            provider: fb_provider,
            api_base: fb["api_base"] || fb[:api_base],
            api_key: fb_key,
            model: fb["model"] || fb[:model]
          }
        end

        # Support singular "backup" key
        backup_cfg = config["backup"] || config[:backup]
        if fallbacks.empty? && backup_cfg.is_a?(Hash)
          fb_provider = backup_cfg["provider"] || backup_cfg[:provider]
          if fb_provider && !fb_provider.to_s.strip.empty?
            fb_key = backup_cfg["api_key"] || backup_cfg[:api_key]
            fb_key_env = backup_cfg["api_key_env"] || backup_cfg[:api_key_env]
            fb_key ||= ENV[fb_key_env] if fb_key_env
            fb_key ||= Aura::LLM::Env.resolve_api_key(fb_provider)
            fallbacks << {
              provider: fb_provider,
              api_base: backup_cfg["api_base"] || backup_cfg[:api_base],
              api_key: fb_key,
              model: backup_cfg["model"] || backup_cfg[:model]
            }
          end
        end

        max_retries = config["max_retries"] || config[:max_retries] || 2

        client = new(
          provider: provider,
          api_base: config["api_base"] || config[:api_base],
          api_key: api_key,
          model: config["model"] || config[:model]
        )
        client.fallbacks = fallbacks if client.respond_to?(:fallbacks=)
        client.max_retries = max_retries if client.respond_to?(:max_retries=)
        client
      end

      def initialize(provider:, api_base: nil, api_key: nil, model: nil)
        @primary_config = {
          provider: provider || "local",
          api_base: api_base,
          api_key: api_key,
          model: model
        }
        @fallbacks = []
        @max_retries = 2
        @current_config = @primary_config
        @adapter = build_adapter(@current_config)
      end

      # Get a chain of all configurations to try: primary followed by fallbacks
      def configs_chain
        [@primary_config] + @fallbacks
      end

      def complete(messages, options = {})
        configs_to_try = configs_chain
        start_idx = configs_to_try.index(@current_config) || 0
        last_error = nil
        
        (start_idx...configs_to_try.length).each do |idx|
          config = configs_to_try[idx]
          
          # If we switched configurations, re-build adapter
          if config != @current_config
            @current_config = config
            @adapter = build_adapter(@current_config)
          end
          
          max_attempts = @max_retries + 1
          (1..max_attempts).each do |attempt|
            begin
              return @adapter.complete(messages, options)
            rescue Aura::LLMError, StandardError => e
              last_error = e
              warn_message = "LLM request failed using provider '#{config[:provider]}' (attempt #{attempt}/#{max_attempts}): #{e.message}"
              warn "\e[33m⚠️ #{warn_message}\e[0m"
              
              if attempt < max_attempts
                sleep(attempt)
              end
            end
          end
          
          if idx + 1 < configs_to_try.length
            next_config = configs_to_try[idx + 1]
            switch_msg = "Provider '#{config[:provider]}' failed all attempts. Switching to backup provider '#{next_config[:provider]}'..."
            warn "\e[31m⚠️ #{switch_msg}\e[0m"
          end
        end
        
        raise last_error if last_error
        raise Aura::LLMError, "LLM request failed (no active configuration)"
      end

      def complete_stream(messages, options = {})
        configs_to_try = configs_chain
        start_idx = configs_to_try.index(@current_config) || 0
        last_error = nil
        
        (start_idx...configs_to_try.length).each do |idx|
          config = configs_to_try[idx]
          
          if config != @current_config
            @current_config = config
            @adapter = build_adapter(@current_config)
          end
          
          max_attempts = @max_retries + 1
          (1..max_attempts).each do |attempt|
            begin
              has_yielded = false
              
              if @adapter.respond_to?(:complete_stream)
                result = @adapter.complete_stream(messages, options) do |delta|
                  has_yielded = true
                  yield(delta) if block_given?
                end
                return result
              else
                out = @adapter.complete(messages, options)
                s = out[:content].to_s
                if block_given?
                  s.each_char do |ch|
                    has_yielded = true
                    yield(ch)
                  end
                end
                return out
              end
              
            rescue Aura::LLMError, StandardError => e
              last_error = e
              
              # If we have already yielded content, failover/retry is no longer safe
              raise e if has_yielded
              
              warn_message = "LLM stream request failed using provider '#{config[:provider]}' (attempt #{attempt}/#{max_attempts}): #{e.message}"
              warn "\e[33m⚠️ #{warn_message}\e[0m"
              
              if attempt < max_attempts
                sleep(attempt)
              end
            end
          end
          
          if idx + 1 < configs_to_try.length
            next_config = configs_to_try[idx + 1]
            switch_msg = "Stream provider '#{config[:provider]}' failed all attempts. Switching to backup provider '#{next_config[:provider]}'..."
            warn "\e[31m⚠️ #{switch_msg}\e[0m"
          end
        end
        
        raise last_error if last_error
        raise Aura::LLMError, "LLM stream request failed (no active configuration)"
      end

      def supports_native_tools?
        @adapter.respond_to?(:supports_native_tools?) && @adapter.supports_native_tools?
      end

      private

      def build_adapter(config = @current_config)
        provider = config[:provider] || "local"
        klass = self.class.adapters[provider.to_s]
        
        if klass.nil?
          # Fallback to local
          require "aura/llm/adapters/local"
          Aura::LLM::Adapters::Local.new
        else
          # Dynamically instantiate the registered adapter class
          klass.new(
            api_base: config[:api_base],
            api_key: config[:api_key],
            model: config[:model]
          )
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
