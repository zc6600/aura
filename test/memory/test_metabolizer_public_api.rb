# frozen_string_literal: true
#
# Test Metabolizer public API is accessible
#

require "minitest/autorun"
require "fileutils"
require "tmpdir"

$LOAD_PATH.unshift File.expand_path("../../lib", __dir__)
require "aura/memory"

class TestMetabolizerPublicApi < Minitest::Test
  def setup
    @test_dir = Dir.mktmpdir("aura_metab_test_")
    config = Aura::Memory::Config.new(store: { project_path: @test_dir })
    @memory = Aura::Memory::Base.new(config: config)
  end

  def teardown
    @memory.store.close
    FileUtils.remove_entry(@test_dir) if File.exist?(@test_dir)
  end

  def test_metabolizer_public_methods_are_accessible
    metabolizer = @memory.metabolizer

    # These should be public and callable
    assert metabolizer.respond_to?(:run_if_needed)
    assert metabolizer.respond_to?(:run)

    result = metabolizer.run_if_needed
    assert result.is_a?(Hash)
    assert result.key?(:total_events)
  end

  def test_run_alias_works
    metabolizer = @memory.metabolizer

    result1 = metabolizer.run_if_needed
    result2 = metabolizer.run

    assert_equal result1.keys, result2.keys
  end

  def test_private_methods_are_not_accessible
    metabolizer = @memory.metabolizer

    # These should be private
    refute metabolizer.respond_to?(:wrap_event_bus, false)
    refute metabolizer.respond_to?(:should_metabolize?, false)
    refute metabolizer.respond_to?(:emit, false)
  end

  def test_metabolizer_integration_works
    50.times do |i|
      @memory.recorder.record_user("Event #{i}")
    end

    metabolizer = @memory.metabolizer

    events_before = @memory.provider.recent_events(limit: 1000).size

    # This should not raise an error
    result = metabolizer.run
    assert result.is_a?(Hash)
  end
end
