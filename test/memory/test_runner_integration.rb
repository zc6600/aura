# frozen_string_literal: true
#
# Test Runner integration with new Memory module
#

require "minitest/autorun"
require "fileutils"
require "tmpdir"

$LOAD_PATH.unshift File.expand_path("../../lib", __dir__)
require "aura"
require "aura/kernel/runner"

class TestRunnerMemoryIntegration < Minitest::Test
  def setup
    @test_dir = Dir.mktmpdir("aura_runner_test_")
    FileUtils.mkdir_p(File.join(@test_dir, "config"))

    @config_yml = <<~YAML
      state_management:
        max_state_chars: 100000
        recent_events_n: 20
    YAML
    File.write(File.join(@test_dir, "config", "config.yml"), @config_yml)
  end

  def teardown
    FileUtils.remove_entry(@test_dir) if File.exist?(@test_dir)
  end

  def test_runner_initialization_with_memory
    runner = Aura::Kernel::Runner.new(@test_dir)

    assert runner.is_a?(Aura::Kernel::Runner)
    assert runner.memory.is_a?(Aura::Memory::Base)
    assert runner.memory.recorder.is_a?(Aura::Memory::Recorder)
    assert runner.memory.provider.is_a?(Aura::Memory::Provider)
    assert runner.memory.metabolizer.is_a?(Aura::Memory::Metabolizer)

    runner.memory.store.close
  end

  def test_runner_record_user_input
    runner = Aura::Kernel::Runner.new(@test_dir)

    event_id = runner.record_user_input("Hello, test!")
    assert event_id.is_a?(Integer)

    events = runner.memory.provider.recent_events
    assert_equal 1, events.size
    assert_equal "user", events[0]["phase"]
    assert_equal "Hello, test!", events[0]["payload"]["content"]

    runner.memory.store.close
  end

  def test_memory_adapter_compatibility
    runner = Aura::Kernel::Runner.new(@test_dir)

    runner.memory.store.set_variable(key: "test_key", value: "test_value")
    assert_equal "test_value", runner.memory.store.get_variable("test_key")

    runner.memory.store.close
  end

  def test_runner_observe
    skip("Requires full framework loading")
  end

  def test_full_workflow_simulation
    runner = Aura::Kernel::Runner.new(@test_dir)

    job = runner.start_job
    assert job.is_a?(Aura::Kernel::Job)
    assert job.status == :running

    user_event_id = runner.record_user_input("List files")

    events = runner.memory.provider.recent_events
    assert_equal 1, events.size

    runner.end_job

    runner.memory.store.close
  end
end
