# frozen_string_literal: true

module Aura
  module Memory
    class Policy
      DEFAULT_TIERS = {
        ephemeral: { phases: %w[execution observe], max_steps: 5, summarize: true },
        working: { phases: %w[plan user], max_steps: 50, summarize: false },
        insights: { phases: %w[learn interception], max_steps: 200, summarize: true },
        permanent: { phases: ["milestone"], permanent: true }
      }.freeze

      DEFAULT_RETENTION = {
        "execution" => { max_steps: 5, summarize: true },
        "observe" => { max_steps: 3, summarize: false },
        "plan" => { max_steps: 50, summarize: false },
        "user" => { max_steps: 100, summarize: false },
        "interception" => { max_steps: 100, summarize: false },
        "milestone" => { permanent: true }
      }.freeze

      def initialize(config = {})
        @tiers = config[:tiers] || DEFAULT_TIERS
        @retention = config[:retention] || DEFAULT_RETENTION
        @registry = config[:registry]
      end

      def tier_for(event)
        phase = event["phase"]
        @tiers.find { |_, tier| tier[:phases]&.include?(phase) }&.first || :working
      end

      def should_summarize?(event, tool_name = nil)
        policy = get_retention_policy(event["phase"], tool_name)
        policy[:summarize] == true
      end

      def permanent?(event, tool_name = nil)
        policy = get_retention_policy(event["phase"], tool_name)
        policy[:permanent] == true
      end

      def apply(events, tool_name = nil)
        to_summarize = []
        to_delete = []
        to_keep = []

        events.each do |event|
          phase = event["phase"]
          tool = event["tool"] || tool_name
          policy = get_retention_policy(phase, tool)

          if policy[:permanent] == true
            to_keep << event
          elsif policy[:summarize] == true
            to_summarize << event
            to_delete << event
          else
            to_delete << event
          end
        end

        { to_summarize: to_summarize, to_delete: to_delete, to_keep: to_keep }
      end

      private

      def get_retention_policy(phase, tool_name = nil)
        if tool_name && @registry
          manifest_policy = get_manifest_retention(tool_name)
          return manifest_policy if manifest_policy
        end

        @retention[phase] || { max_steps: 50, summarize: false }
      end

      def get_manifest_retention(tool_name)
        return nil unless @registry

        tool_data = @registry.find(tool_name)
        return nil unless tool_data

        manifest = tool_data[:manifest] || {}
        memory_config = manifest["memory"]
        return nil unless memory_config

        {
          max_steps: memory_config["max_steps"] || 50,
          summarize: memory_config["summarize"] || false,
          permanent: memory_config["permanent"] || false,
          retention: memory_config["retention"] || "working"
        }
      end
    end
  end
end
