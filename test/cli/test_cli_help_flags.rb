require "minitest/autorun"
require "stringio"
require "aura/cli/entry"

class TestCliHelpFlags < Minitest::Test
  def setup
    require "aura/cli/commands/application_command"
    @klass = Aura::Commands::ApplicationCommand
  end

  def test_dash_h_routes_to_help
    start_was = @klass.method(:start)
    begin
      $called = false
      @klass.define_singleton_method(:start) do |argv, config = {}|
        $called = argv.first == "help"
      end
      Aura::CLI::EntryPoint.start(["-h"]) 
      assert $called, "-h did not route to help"
    ensure
      @klass.define_singleton_method(:start) do |*args|
        start_was.call(*args)
      end
    end
  end

  def test_dash_dash_help_routes_to_help
    start_was = @klass.method(:start)
    begin
      $called = false
      @klass.define_singleton_method(:start) do |argv, config = {}|
        $called = argv.first == "help"
      end
      Aura::CLI::EntryPoint.start(["--help"]) 
      assert $called, "--help did not route to help"
    ensure
      @klass.define_singleton_method(:start) do |*args|
        start_was.call(*args)
      end
    end
  end

  def test_empty_args_routes_to_help
    start_was = @klass.method(:start)
    begin
      $called = false
      @klass.define_singleton_method(:start) do |argv, config = {}|
        $called = argv.first == "help"
      end
      Aura::CLI::EntryPoint.start([])
      assert $called, "empty args did not route to help"
    ensure
      @klass.define_singleton_method(:start) do |*args|
        start_was.call(*args)
      end
    end
  end
end
