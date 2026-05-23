# frozen_string_literal: true

require "aura/memory"

module Aura
  module Kernel
    # Backward compatibility wrapper that proxies requests to the new Aura::Memory system.
    # This prevents breaking existing tests, CLI commands, and plugins during migration.
    class State
      attr_reader :project_path, :memory, :adapter

      def initialize(project_path)
        # Note: original State initialized with environment path if possible.
        @project_path = (defined?(Aura) && Aura.respond_to?(:environment_path)) ? (Aura::PathResolver.environment_path(project_path) || project_path) : project_path
        
        config_file = Aura::PathResolver.resolve_config_path(@project_path)
        config_hash = {}
        if config_file && File.exist?(config_file)
          begin
            require "yaml"
            parsed = Aura.respond_to?(:safe_load_yaml) ? Aura.safe_load_yaml(config_file) : (YAML.safe_load_file(config_file) rescue {})
            config_hash = parsed["state_management"] || {}
          rescue => e
            $stderr.puts "[State] Failed to load config from #{config_file}: #{e.message}"
          end
        end

        config_hash = config_hash.dup
        config_hash[:store] ||= {}
        config_hash[:store][:project_path] = @project_path

        config = Aura::Memory::Config.new(config_hash)
        @memory = Aura::Memory::Base.new(config: config)
        @adapter = Aura::Memory::Adapters::CompatibilityAdapter.new(@memory)
        @db_path = db_path
        @db = @memory.store.instance_variable_get(:@db)
      end

      def db_path
        @memory.store.instance_variable_get(:@db_path)
      end

      def record_event(payload)
        @adapter.record_event(payload)
      end

      def commit_summary(content, source_event_id = nil)
        @adapter.commit_summary(content, source_event_id)
      end

      def metabolize_if_needed
        @memory.metabolize_if_needed
      end

      def get_active_variables
        @adapter.get_active_variables
      end

      def set_variable(key, value)
        @adapter.set_variable(key, value)
      end

      def get_latest_summary
        @adapter.get_latest_summary
      end

      def get_recent_summaries(limit = nil)
        @adapter.get_recent_summaries(limit)
      end

      def get_recent_summaries_structured(limit: nil)
        @adapter.get_recent_summaries_structured(limit: limit)
      end

      def get_recent_events
        @adapter.get_recent_events
      end

      def get_recent_events_structured(*args, **kwargs)
        @adapter.get_recent_events_structured(*args, **kwargs)
      end

      def undo_last_turn
        @adapter.undo_last_turn
      end

      def redo_last_turn
        @adapter.redo_last_turn
      end

      def close
        @adapter.close
      end
    end
  end
end
