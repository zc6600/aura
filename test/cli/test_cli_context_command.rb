require "minitest/autorun"
require "aura/cli"

class TestCliContextCommand < Minitest::Test
  def setup
    require "aura/commands/application_command"
    @klass = Aura::Commands::ApplicationCommand
  end

  def test_context_routes
    start_was = @klass.method(:start)
    begin
      called_args = nil
      @klass.define_singleton_method(:start) do |argv, config = {}|
        called_args = argv
      end
      Aura::CLI.start(["context", "/tmp/x"]) 
      assert_equal "context", called_args.first
      assert_equal "/tmp/x", called_args[1]
    ensure
      @klass.define_singleton_method(:start) do |*args|
        start_was.call(*args)
      end
    end
  end
end

