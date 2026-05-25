# frozen_string_literal: true

module Aura
  module LLM
    class Client
      @adapters = {}

      # Class-level registry methods
      def self.register_adapter(provider_name, klass)
        @adapters[provider_name.to_s] = klass
      end

      class << self
        attr_reader :adapters
      end

      attr_accessor :fallbacks, :max_retries, :event_bus

      # Special exception to abort stream failovers once chunks are yielded
      class NonRetryableStreamError < StandardError
        attr_reader :original_error

        def initialize(err)
          super(err.message)
          @original_error = err
        end
      end

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
          if fb_provider.nil? || fb_provider.to_s.strip.empty?
            warn "\e[31m⚠️ Invalid fallback configuration: missing 'provider'\e[0m"
            next
          end

          fb_key = fb["api_key"] || fb[:api_key]
          fb_key_env = fb["api_key_env"] || fb[:api_key_env]
          fb_key ||= ENV[fb_key_env] if fb_key_env
          fb_key ||= Aura::LLM::Env.resolve_api_key(fb_provider)

          fallbacks << {
            provider: fb_provider,
            api_base: fb["api_base"] || fb[:api_base],
            api_key: fb_key,
            model: fb["model"] || fb[:model],
            max_retries: fb["max_retries"] || fb[:max_retries]
          }
        end

        # Support singular "backup" key
        backup_cfg = config["backup"] || config[:backup]
        if fallbacks.empty? && backup_cfg.is_a?(Hash)
          fb_provider = backup_cfg["provider"] || backup_cfg[:provider]
          if fb_provider.nil? || fb_provider.to_s.strip.empty?
            warn "\e[31m⚠️ Invalid backup configuration: missing 'provider'\e[0m"
          else
            fb_key = backup_cfg["api_key"] || backup_cfg[:api_key]
            fb_key_env = backup_cfg["api_key_env"] || backup_cfg[:api_key_env]
            fb_key ||= ENV[fb_key_env] if fb_key_env
            fb_key ||= Aura::LLM::Env.resolve_api_key(fb_provider)
            fallbacks << {
              provider: fb_provider,
              api_base: backup_cfg["api_base"] || backup_cfg[:api_base],
              api_key: fb_key,
              model: backup_cfg["model"] || backup_cfg[:model],
              max_retries: backup_cfg["max_retries"] || backup_cfg[:max_retries]
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
        @health_registry = {}
      end

      # Get a chain of all configurations to try: primary followed by fallbacks
      def configs_chain
        [@primary_config] + (@fallbacks || [])
      end

      def complete(messages, options = {})
        with_fallback do |adapter, _config|
          adapter.complete(messages, options)
        end
      end

      def complete_stream(messages, options = {})
        has_yielded = false
        with_fallback do |adapter, _config|
          if adapter.respond_to?(:complete_stream)
            adapter.complete_stream(messages, options) do |delta|
              has_yielded = true
              yield(delta) if block_given?
            end
          else
            out = adapter.complete(messages, options)
            s = out[:content].to_s
            if block_given?
              s.each_char do |ch|
                has_yielded = true
                yield(ch)
              end
            end
            out
          end
        rescue Aura::LLMError => e
          raise NonRetryableStreamError, e if has_yielded

          raise e
        end
      rescue NonRetryableStreamError => e
        raise e.original_error
      end

      def supports_native_tools?
        @adapter.respond_to?(:supports_native_tools?) && @adapter.supports_native_tools?
      end

      private

      # Shared logic wrapper for retrying and falling back
      def with_fallback
        configs_to_try = configs_chain
        active_configs = filter_configs(configs_to_try)

        # If all configs are currently tripped by the circuit breaker, fall back to trying all of them
        active_configs = configs_to_try if active_configs.empty?

        last_error = nil

        active_configs.each_with_index do |config, idx|
          if config != @current_config
            @current_config = config
            @adapter = build_adapter(@current_config)
          end

          # Support per-fallback max_retries
          config_retries = config[:max_retries] || @max_retries || 2
          max_attempts = config_retries + 1

          (1..max_attempts).each do |attempt|
            result = yield(@adapter, config)

            # Success! Reset provider health
            reset_provider_health(config)
            return result
          rescue Aura::LLMError => e
            last_error = e

            # Immediately escalate if it's a non-retryable stream error wrapped in NonRetryableStreamError
            raise e if e.is_a?(NonRetryableStreamError)

            # Record failure
            record_provider_failure(config)

            # Skip retry loop if error is not retryable (e.g. Auth Error or 400 Bad Request)
            break unless retryable_error?(e)

            warn_message = "LLM request failed using provider '#{config[:provider]}' (attempt #{attempt}/#{max_attempts}): #{e.message}"
            emit_warning_message(warn_message)

            if attempt < max_attempts
              # Exponential backoff: 2 ** (attempt - 1) up to a cap of 10s
              backoff_time = [2**(attempt - 1), 10].min
              sleep(backoff_time)
            end
          end

          next unless idx + 1 < active_configs.length

          next_config = active_configs[idx + 1]
          switch_msg = "Provider '#{config[:provider]}' failed all attempts. Switching to backup provider '#{next_config[:provider]}'..."
          emit_warning_message(switch_msg)
        end

        raise last_error if last_error

        raise Aura::LLMError, "LLM request failed (no active configuration)"
      end

      # Filter out configurations that have failed too many times within the cooldown window
      def filter_configs(configs)
        now = Time.now
        configs.select do |cfg|
          key = config_key(cfg)
          health = @health_registry[key]
          if health && health[:failure_count] >= 3 && (now - health[:last_failed_at] < 30)
            false
          else
            true
          end
        end
      end

      def record_provider_failure(cfg)
        key = config_key(cfg)
        @health_registry[key] ||= { failure_count: 0, last_failed_at: nil }
        @health_registry[key][:failure_count] += 1
        @health_registry[key][:last_failed_at] = Time.now
      end

      def reset_provider_health(cfg)
        key = config_key(cfg)
        @health_registry[key] = { failure_count: 0, last_failed_at: nil }
      end

      def config_key(cfg)
        "#{cfg[:provider]}_#{cfg[:model]}_#{cfg[:api_base]}"
      end

      # Helper to check if an error is transient/retryable
      def retryable_error?(error)
        case error
        when Aura::LLMAuthError
          false
        when Aura::LLMTimeoutError
          true
        when Aura::LLMError
          # Parse error message to determine status code if available
          # Formats from validate_response_code!: "LLM API Error (code): ..."
          if error.message =~ /API Error \((\d+)\)/
            code = ::Regexp.last_match(1).to_i
            # 429: Rate Limit, 5xx: Server Errors
            code == 429 || (code >= 500 && code < 600)
          else
            # Default to true for connection failures (e.g. SocketError / Net::HTTP connection refused)
            # which are wrapped as Aura::LLMError without a specific HTTP status code
            true
          end
        else
          false
        end
      end

      # Emit log warnings through the event bus if available, or write to warn
      def emit_warning_message(msg)
        if @event_bus.respond_to?(:emit)
          @event_bus.emit(:warning, message: msg)
        else
          warn "\e[33m⚠️ #{msg}\e[0m"
        end
      end

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
