# frozen_string_literal: true

module Aura
  module Memory
    class Metabolizer
      def initialize(store:, policy:, summarizer:, metabolism_config: {}, event_bus: nil, registry: nil)
        @store = store
        @policy = policy
        @summarizer = summarizer
        @metabolism_config = metabolism_config
        @event_bus = wrap_event_bus(event_bus)
        @registry = registry
      end

      def run_if_needed
        stats = {
          total_events: 0,
          candidates_for_summary: 0,
          summarized: 0,
          deleted: 0,
          errors: 0
        }

        begin
          stats[:total_events] = @store.count_events

          return stats unless should_metabolize? && stats[:total_events] > recent_events_n

          emit(:metabolism_start, event_count: stats[:total_events], total_chars: @store.total_events_chars)

          old_events = select_old_events
          return stats if old_events.empty?

          retention_result = @policy.apply(old_events)
          stats[:candidates_for_summary] = retention_result[:to_summarize].size

          if retention_result[:to_summarize].any?
            summary = generate_metabolism_summary(retention_result[:to_summarize])
            if summary && !summary.empty?
              @store.insert_summary(content: "Metabolism: Narrative Summary - #{summary}")
              stats[:summarized] = retention_result[:to_summarize].size
              emit(:metabolism_summary, content: summary)
            end
          end

          ids_to_delete = retention_result[:to_delete].map { |e| e["id"] }
          if ids_to_delete.any?
            @store.delete_events(ids_to_delete)
            stats[:deleted] = ids_to_delete.size
            emit(:metabolism_complete, deleted_count: stats[:deleted])
          end
        rescue StandardError => e
          stats[:errors] += 1
          $stderr.puts "[Memory::Metabolizer] Error: #{e.message}"
          $stderr.puts e.backtrace.first(5).join("\n")
        end

        stats
      end
      alias run run_if_needed

      private

      def wrap_event_bus(bus)
        return bus if bus.nil? || bus.is_a?(EventBus)
        EventBus.new(bus)
      end

      def should_metabolize?
        total_chars = @store.total_events_chars
        event_count = @store.count_events
        max_chars = @metabolism_config[:max_chars] || 100_000
        recent_n = recent_events_n

        total_chars > max_chars || event_count > recent_n * 5
      end

      def recent_events_n
        @metabolism_config[:recent_events_n] || 20
      end

      def select_old_events
        keep_recent = recent_events_n
        offset = [keep_recent - 1, 0].max
        @store.fetch_events(offset: offset)
      end

      def generate_metabolism_summary(events)
        return nil unless summarization_enabled?

        max_chars = @metabolism_config.dig(:summarization, :max_chars) || 500
        summary = @summarizer.synthesize(events)
        summary = summary[0, max_chars] if summary && summary.length > max_chars
        summary
      rescue StandardError => e
        $stderr.puts "[Memory::Metabolizer] Summary generation failed: #{e.message}"
        nil
      end

      def summarization_enabled?
        val = @metabolism_config.dig(:summarization, :enabled)
        val.nil? ? true : (val == true)
      end

      def emit(event, data = {})
        @event_bus&.emit(event, data) if @event_bus
      end
    end
  end
end
