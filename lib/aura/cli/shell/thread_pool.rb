# frozen_string_literal: true

# Simple thread pool for concurrent request handling
class ThreadPool
  def initialize(max_threads: 10)
    @queue = Queue.new
    @max_threads = max_threads
    @workers = []

    @max_threads.times do
      @workers << Thread.new do
        loop do
          job = @queue.pop

          break if job.nil?

          job.call
        rescue StandardError => e
          warn "Thread pool error: #{e.message}"
        end
      end
    end
  end

  def post(&block)
    @queue << block
  end

  def shutdown
    @max_threads.times { @queue << nil }
    @workers.each(&:join)
  end
end
