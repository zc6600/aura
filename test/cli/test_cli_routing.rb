require "minitest/autorun"
require "aura/cli/entry"

class TestCliRouting < Minitest::Test
  def setup
    require "aura/cli/commands/application_command"
    @klass = Aura::Commands::ApplicationCommand
    @start_was = @klass.method(:start)
  end

  def teardown
    start_was = @start_was
    @klass.define_singleton_method(:start) do |*args|
      start_was.call(*args)
    end
  end

  def test_help_routes_to_application
    $called = false
    @klass.define_singleton_method(:start) do |*|
      $called = true
    end

    Aura::CLI::EntryPoint.start(["help"]) # should dispatch to ApplicationCommand.start
    assert $called, "CLI did not dispatch to ApplicationCommand"
  end
end

