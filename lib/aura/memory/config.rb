# frozen_string_literal: true

require "yaml"

module Aura
  module Memory
    class Config
      DEFAULT_METABOLISM = {
        max_chars: 100_000,
        recent_events_n: 20,
        keep_last_summary_n_steps: 20
      }.freeze

      DEFAULT_STORE = {
        type: :sqlite
      }.freeze

      def initialize(hash = {})
        @hash = deep_symbolize_keys(hash)
      end

      def store_config
        @hash[:store] || DEFAULT_STORE
      end

      def retention_policy
        Policy.new(@hash[:retention] || {})
      end

      def summarizer
        @hash[:summarizer] || default_summarizer
      end

      def metabolism
        meta = @hash[:metabolism] || {}
        {
          max_chars: meta[:max_chars] || @hash[:max_state_chars] || @hash[:max_chars] || DEFAULT_METABOLISM[:max_chars],
          recent_events_n: meta[:recent_events_n] || @hash[:recent_events_n] || DEFAULT_METABOLISM[:recent_events_n],
          keep_last_summary_n_steps: meta[:keep_last_summary_n_steps] || @hash[:keep_last_summary_n_steps] || DEFAULT_METABOLISM[:keep_last_summary_n_steps],
          summarization: meta[:summarization] || @hash[:summarization]
        }
      end

      def self.from_file(path)
        return new unless File.exist?(path)

        config_data = YAML.safe_load_file(path) || {}
        memory_config = config_data["state_management"] || {}
        new(memory_config)
      end

      private

      def default_summarizer
        Summarizer.new
      end

      def deep_symbolize_keys(obj)
        case obj
        when Hash
          obj.each_with_object({}) do |(k, v), result|
            result[k.to_sym] = deep_symbolize_keys(v)
          end
        when Array
          obj.map { |v| deep_symbolize_keys(v) }
        else
          obj
        end
      end
    end
  end
end
