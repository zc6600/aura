# frozen_string_literal: true

# Simple connection pool for database connections
class ConnectionPool
  def initialize(size:, &block)
    @size = size
    @connections = []
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
    @connections.each(&:close)
  end

  private

  def checkout
    @mutex.synchronize do
      while @connections.empty?
        if @connections.size >= @size
          @condition.wait(@mutex)
        else
          @connections << @block.call
        end
      end
      @connections.pop
    end
  end

  def checkin(conn)
    @mutex.synchronize do
      @connections << conn
      @condition.signal
    end
  end
end
