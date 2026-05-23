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
        @hash[:metabolism] || DEFAULT_METABOLISM
      end

      def self.from_file(path)
        return new unless File.exist?(path)

        config_data = YAML.safe_load_file(path) || {}
        memory_config = config_data.dig("state_management") || {}
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
