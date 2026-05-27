# frozen_string_literal: true

require "json"
require "time"
require "fileutils"
require "securerandom"

module Aura
  module Context
    class Manager
      attr_reader :env_path

      def initialize(path)
        resolved_env = defined?(Aura) && Aura.respond_to?(:environment_path) ? (Aura::PathResolver.environment_path(path) || path) : path
        @env_path = File.expand_path(resolved_env)
        override_path = ENV.fetch("AURA_TOOL_CONTEXTS_PATH", nil)
        @state_file = if override_path && !override_path.to_s.strip.empty?
                        File.expand_path(override_path, @env_path)
                      else
                        File.join(@env_path, "state", "tool_contexts.json")
                      end
      end

      def project_path
        @env_path
      end

      def add_context(type, data = {}, id: nil)
        contexts = load_contexts
        id ||= "#{type}_#{SecureRandom.hex(4)}"

        contexts[id] = {
          "type" => type,
          "created_at" => Time.now.iso8601,
          "created_turn" => current_turn,
          "last_used_at" => Time.now.iso8601,
          "last_used_turn" => current_turn,
          "data" => data
        }

        save_contexts(contexts)
        id
      end

      def remove_context(id)
        contexts = load_contexts
        return false unless contexts.delete(id)

        save_contexts(contexts)
        true
      end

      def update_activity(id, turn = nil)
        contexts = load_contexts
        ctx = contexts[id]
        return false unless ctx

        ctx["last_used_at"] = Time.now.iso8601
        ctx["last_used_turn"] = turn if turn
        save_contexts(contexts)
        true
      end

      def active_contexts(type = nil)
        ctxs = load_contexts
        if type
          ctxs.select { |_, v| v["type"] == type }
        else
          ctxs
        end
      end

      def maintenance(current_turn, ttl_configs = {})
        @current_turn = current_turn
        contexts = load_contexts
        initial_count = contexts.count

        contexts.delete_if do |_id, ctx|
          !context_active?(ctx, ttl_configs[ctx["type"]])
        end

        save_contexts(contexts) if contexts.count != initial_count
        contexts
      end

      def load_contexts
        return {} unless File.exist?(@state_file)

        begin
          data = JSON.parse(File.read(@state_file))
          data["contexts"] || {}
        rescue StandardError
          {}
        end
      end

      private

      def save_contexts(contexts)
        dir = File.dirname(@state_file)
        FileUtils.mkdir_p(dir) unless Dir.exist?(dir)
        File.write(@state_file, JSON.pretty_generate({ contexts: contexts }))
      end

      def current_turn
        @current_turn || 0
      end

      def context_active?(ctx, ttl_config)
        return true unless ttl_config

        pass_turns = true
        pass_time = true

        if ttl_config["turns"]
          # Sliding TTL: check against last_used instead of created
          age_turns = current_turn - (ctx["last_used_turn"] || ctx["created_turn"] || 0)
          pass_turns = age_turns < ttl_config["turns"]
        end

        if ttl_config["seconds"]
          # Sliding TTL: check against last_used instead of created
          last_used_at = begin
            Time.parse(ctx["last_used_at"] || ctx["created_at"])
          rescue StandardError
            Time.now
          end
          age_seconds = Time.now - last_used_at
          pass_time = age_seconds < ttl_config["seconds"]
        end

        policy = ttl_config["policy"] || "any"
        if policy == "all"
          pass_turns || pass_time
        else
          pass_turns && pass_time
        end
      end
    end
  end
end
