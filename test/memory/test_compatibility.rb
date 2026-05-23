# frozen_string_literal: true
#
# Test backward compatibility improvements
#

require "minitest/autorun"
require "fileutils"
require "tmpdir"

$LOAD_PATH.unshift File.expand_path("../../lib", __dir__)
require "aura/memory"

class TestMemoryCompatibility < Minitest::Test
  def setup
    @test_dir = Dir.mktmpdir("aura_compat_test_")
  end

  def teardown
    FileUtils.remove_entry(@test_dir) if File.exist?(@test_dir)
  end

  def test_payload_contains_phase_field_backward_compatibility
    config = Aura::Memory::Config.new(store: { project_path: @test_dir })
    memory = Aura::Memory::Base.new(config: config)

    memory.recorder.record_user("Hello, test!")

    events = memory.provider.recent_events
    assert_equal 1, events.size

    payload = events[0]["payload"]
    assert payload.is_a?(Hash) || payload.is_a?(String)

    if payload.is_a?(Hash)
      assert payload.key?("phase"), "payload should contain 'phase' field for backward compatibility"
      assert_equal "user", payload["phase"]
    end

    memory.store.close
  end

  def test_plan_payload_contains_phase_and_tool
    config = Aura::Memory::Config.new(store: { project_path: @test_dir })
    memory = Aura::Memory::Base.new(config: config)

    memory.recorder.record_plan(
      tool: "read_file",
      args: { file_path: "test.rb" },
      thought: "Thinking...",
      summary: "Reading file"
    )

    events = memory.provider.recent_events
    assert_equal 1, events.size

    payload = events[0]["payload"]
    if payload.is_a?(Hash)
      assert payload.key?("phase")
      assert payload.key?("tool")
      assert_equal "plan", payload["phase"]
      assert_equal "read_file", payload["tool"]
    end

    memory.store.close
  end

  def test_execution_payload_contains_phase_and_tool
    config = Aura::Memory::Config.new(store: { project_path: @test_dir })
    memory = Aura::Memory::Base.new(config: config)

    memory.recorder.record_execution("bash_command", { status: "ok", output: "hello" })

    events = memory.provider.recent_events
    assert_equal 1, events.size

    payload = events[0]["payload"]
    if payload.is_a?(Hash)
      assert payload.key?("phase")
      assert payload.key?("tool")
      assert_equal "execution", payload["phase"]
      assert_equal "bash_command", payload["tool"]
    end

    memory.store.close
  end

  def test_all_event_types_have_phase_in_payload
    config = Aura::Memory::Config.new(store: { project_path: @test_dir })
    memory = Aura::Memory::Base.new(config: config)

    memory.recorder.record_user("user event")
    memory.recorder.record_plan(tool: "test", args: {})
    memory.recorder.record_execution("test_tool", {})
    memory.recorder.record_interception("blocked", "advice")
    memory.recorder.record_custom("custom", {})

    events = memory.provider.recent_events
    assert_equal 5, events.size

    events.each do |event|
      payload = event["payload"]
      if payload.is_a?(Hash)
        assert payload.key?("phase"), "Event #{event['phase']} should have phase in payload"
        assert_equal event["phase"], payload["phase"]
      end
    end

    memory.store.close
  end
end
