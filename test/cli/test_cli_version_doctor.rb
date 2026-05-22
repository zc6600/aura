require "minitest/autorun"
require "aura/cli/entry"

class TestCliVersionDoctor < Minitest::Test
  def setup
    require "aura/cli/commands/application_command"
    @klass = Aura::Commands::ApplicationCommand
  end

  def test_version_routes
    start_was = @klass.method(:start)
    begin
      called_args = nil
      @klass.define_singleton_method(:start) do |argv, config = {}|
        called_args = argv
      end
      Aura::CLI::EntryPoint.start(["version"]) 
      assert_equal "version", called_args.first
    ensure
      @klass.define_singleton_method(:start) do |*args|
        start_was.call(*args)
      end
    end
  end

  def test_doctor_routes
    start_was = @klass.method(:start)
    begin
      called_args = nil
      @klass.define_singleton_method(:start) do |argv, config = {}|
        called_args = argv
      end
      Aura::CLI::EntryPoint.start(["doctor"]) 
      assert_equal "doctor", called_args.first
    ensure
      @klass.define_singleton_method(:start) do |*args|
        start_was.call(*args)
      end
    end
  end

  def test_info_routes
    start_was = @klass.method(:start)
    begin
      called_args = nil
      @klass.define_singleton_method(:start) do |argv, config = {}|
        called_args = argv
      end
      Aura::CLI::EntryPoint.start(["info"]) 
      assert_equal "info", called_args.first
    ensure
      @klass.define_singleton_method(:start) do |*args|
        start_was.call(*args)
      end
    end
  end
end
