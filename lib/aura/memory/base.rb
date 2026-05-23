# frozen_string_literal: true

module Aura
  module Memory
    class Base
      attr_reader :recorder, :provider, :metabolizer, :store, :config

      def initialize(config:, store: nil, event_bus: nil)
        @config = config.is_a?(Config) ? config : Config.new(config)
        @store = store || default_store
        @event_bus = event_bus

        @recorder = Recorder.new(@store)
        @provider = Provider.new(@store)
        @metabolizer = Metabolizer.new(
          store: @store,
          policy: @config.retention_policy,
          summarizer: @config.summarizer,
          metabolism_config: @config.metabolism,
          event_bus: @event_bus
        )
      end

      def metabolize_if_needed
        @metabolizer.run_if_needed
      end

      def metabolize
        @metabolizer.run
      end

      def undo
        @store.respond_to?(:undo_last_turn) ? @store.undo_last_turn : false
      end

      def redo
        @store.respond_to?(:redo_last_turn) ? @store.redo_last_turn : false
      end

      private

      def default_store
        Stores::SQLiteStore.new(@config.store_config)
      end
    end
  end
end
