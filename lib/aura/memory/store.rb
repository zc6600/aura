# frozen_string_literal: true

require "json"

module Aura
  module Memory
    class Store
      def insert_event(timestamp:, phase:, tool:, payload:)
        raise NotImplementedError, "#{self.class} must implement #insert_event"
      end

      def fetch_events(limit: nil, offset: nil, phases: nil, since: nil, tools: nil)
        raise NotImplementedError, "#{self.class} must implement #fetch_events"
      end

      def delete_events(event_ids)
        raise NotImplementedError, "#{self.class} must implement #delete_events"
      end

      def count_events
        raise NotImplementedError, "#{self.class} must implement #count_events"
      end

      def total_events_chars
        raise NotImplementedError, "#{self.class} must implement #total_events_chars"
      end

      def insert_summary(content:, source_event_id: nil)
        raise NotImplementedError, "#{self.class} must implement #insert_summary"
      end

      def fetch_summaries(limit: nil)
        raise NotImplementedError, "#{self.class} must implement #fetch_summaries"
      end

      def set_variable(key:, value:)
        raise NotImplementedError, "#{self.class} must implement #set_variable"
      end

      def get_variable(key)
        raise NotImplementedError, "#{self.class} must implement #get_variable"
      end

      def all_variables
        raise NotImplementedError, "#{self.class} must implement #all_variables"
      end

      def transaction
        raise NotImplementedError, "#{self.class} must implement #transaction"
      end

      def close; end

      protected

      def serialize_payload(payload)
        payload.is_a?(String) ? payload : JSON.generate(payload)
      end

      def deserialize_payload(payload_str)
        return payload_str unless payload_str.is_a?(String)

        JSON.parse(payload_str)
      rescue JSON::ParserError
        payload_str
      end
    end
  end
end
