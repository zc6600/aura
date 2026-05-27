# frozen_string_literal: true

# Simple connection pool for database connections
class ConnectionPool
  def initialize(size:, &block)
    @size = size
    @connections = []
    @allocated = 0
    @block = block
    @mutex = Mutex.new
    @condition = ConditionVariable.new
  end

  def with
    conn = checkout
    yield conn
  ensure
    checkin(conn)
  end

  def close
    @mutex.synchronize do
      @connections.each(&:close)
      @connections.clear
      @allocated = 0
    end
  end

  private

  def checkout
    @mutex.synchronize do
      @condition.wait(@mutex) while @connections.empty? && @allocated >= @size

      if @connections.empty?
        conn = @block.call
        @allocated += 1
        conn
      else
        @connections.pop
      end
    end
  end

  def checkin(conn)
    @mutex.synchronize do
      @connections << conn
      @condition.signal
    end
  end
end
