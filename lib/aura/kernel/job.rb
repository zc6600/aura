# frozen_string_literal: true

require "securerandom"

module Aura
  module Kernel
    class Job
      attr_reader :id, :status, :started_at, :ended_at, :events, :metadata

      def initialize(metadata = {})
        @id = SecureRandom.uuid
        @status = :pending # :pending, :running, :completed, :failed
        @started_at = nil
        @ended_at = nil
        @events = []
        @metadata = metadata
      end

      def start!
        @started_at = Time.now
        @status = :running
      end

      def complete!
        @ended_at = Time.now
        @status = :completed
      end

      def fail!(error)
        @ended_at = Time.now
        @status = :failed
        @metadata[:error] = error.message
      end

      def add_event(event_id)
        @events << event_id
      end

      def to_h
        {
          id: @id,
          status: @status,
          started_at: @started_at,
          ended_at: @ended_at,
          events: @events,
          metadata: @metadata
        }
      end
    end
  end
end
