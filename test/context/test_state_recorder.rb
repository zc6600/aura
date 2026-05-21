# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "sqlite3"
require "aura/kernel/state"
require "aura/context/state_recorder"

class TestStateRecorder < Minitest::Test
  def setup
    @test_dir = File.expand_path("tmp_test_state_recorder", __dir__)
    FileUtils.rm_rf(@test_dir)
    FileUtils.mkdir_p(@test_dir)
    @state = Aura::Kernel::State.new(@test_dir)
    @recorder = Aura::Context::StateRecorder.new(@state)
  end

  def teardown
    @state.close rescue nil
    FileUtils.rm_rf(@test_dir)
  end

  def test_record_user_event
    event_id = @recorder.record_user("Hello, world!")
    assert event_id.is_a?(Integer)
    assert event_id > 0

    # Verify it was stored correctly
    events = @state.send(:get_recent_events_structured, phases: ["user"])
    assert_equal 1, events.size
    assert_equal "user", events[0]["phase"]
    assert_equal "Hello, world!", events[0]["payload"]["content"]
  end

  def test_record_user_with_call_seq
    event_id = @recorder.record_user("Test message", call_seq: 42)
    events = @state.send(:get_recent_events_structured, phases: ["user"])
    assert_equal 42, events[0]["payload"]["call_seq"]
  end

  def test_record_plan_with_thought
    plan = {
      type: "tool_call",
      tool: "read_file",
      args: { "file_path" => "config.yml" },
      thought: "让我先检查一下配置文件",
      summary: "读取配置文件"
    }

    event_id = @recorder.record_plan(plan)
    assert event_id.is_a?(Integer)

    events = @state.send(:get_recent_events_structured, phases: ["plan"])
    assert_equal 1, events.size
    payload = events[0]["payload"]
    assert_equal "read_file", payload["tool"]
    assert_equal "让我先检查一下配置文件", payload["thought"]
    assert_equal "读取配置文件", payload["summary"]
    assert_equal({ "file_path" => "config.yml" }, payload["args"])
  end

  def test_record_plan_preserves_extra_fields
    plan = {
      tool: "bash_command",
      args: { "command" => "ls" },
      summary: "List files",
      custom_field: "custom_value",
      another_field: 123
    }

    @recorder.record_plan(plan)
    events = @state.send(:get_recent_events_structured, phases: ["plan"])
    payload = events[0]["payload"]
    assert_equal "custom_value", payload["custom_field"]
    assert_equal 123, payload["another_field"]
  end

  def test_record_plan_returns_nil_for_non_hash
    assert_nil @recorder.record_plan("invalid")
    assert_nil @recorder.record_plan(nil)
  end

  def test_record_execution
    result = {
      status: "ok",
      output: "file1.rb\nfile2.rb",
      success: true
    }

    event_id = @recorder.record_execution("read_file", result, call_seq: 1)
    assert event_id.is_a?(Integer)

    events = @state.send(:get_recent_events_structured, phases: ["execution"])
    assert_equal 1, events.size
    assert_equal "read_file", events[0]["tool"]
    assert_equal "ok", events[0]["payload"]["result"]["status"]
    assert_equal 1, events[0]["payload"]["call_seq"]
  end

  def test_record_execution_with_non_hash_result
    event_id = @recorder.record_execution("simple_tool", "plain output", call_seq: 2)
    events = @state.send(:get_recent_events_structured, phases: ["execution"])
    payload = events[0]["payload"]
    assert_equal({ "output" => "plain output" }, payload["result"])
  end

  def test_record_interception
    event_id = @recorder.record_interception("dangerous_tool", "Tool is not safe", reason: "Security check failed")
    assert event_id.is_a?(Integer)

    events = @state.send(:get_recent_events_structured, phases: ["interception"])
    assert_equal 1, events.size
    assert_equal "dangerous_tool", events[0]["tool"]
    assert_equal "Tool is not safe", events[0]["payload"]["advice"]
    assert_equal "Security check failed", events[0]["payload"]["reason"]
  end

  def test_record_interception_without_reason
    @recorder.record_interception("blocked_tool", "Blocked")
    events = @state.send(:get_recent_events_structured, phases: ["interception"])
    refute events[0]["payload"].key?("reason")
  end

  def test_record_custom_event
    event_id = @recorder.record_custom("custom_phase", { data: "test", value: 42 })
    assert event_id.is_a?(Integer)

    events = @state.send(:get_recent_events_structured, phases: ["custom_phase"])
    assert_equal 1, events.size
    assert_equal "test", events[0]["payload"]["data"]
    assert_equal 42, events[0]["payload"]["value"]
  end

  def test_record_batch
    events = [
      { type: "user", content: "Hello" },
      { type: "plan", plan: { tool: "read_file", args: {}, thought: "Thinking", summary: "Read" } },
      { type: "execution", tool: "read_file", result: { status: "ok" }, call_seq: 1 }
    ]

    event_ids = @recorder.record_batch(events)
    assert_equal 3, event_ids.size
    assert event_ids.all? { |id| id.is_a?(Integer) }

    # Verify all events were recorded
    all_events = @state.send(:get_recent_events_structured)
    phases = all_events.map { |e| e["phase"] }
    assert_includes phases, "user"
    assert_includes phases, "plan"
    assert_includes phases, "execution"
  end

  def test_complete_workflow
    # Simulate a complete agent workflow
    user_id = @recorder.record_user("List all Ruby files")
    
    plan = {
      tool: "bash_command",
      args: { "command" => "find . -name '*.rb'" },
      thought: "I'll use find to search for Ruby files",
      summary: "Finding Ruby files"
    }
    plan_id = @recorder.record_plan(plan)
    
    result = { status: "ok", output: "file1.rb\nfile2.rb" }
    exec_id = @recorder.record_execution("bash_command", result, call_seq: user_id)

    # Verify all events are in order
    all_events = @state.send(:get_recent_events_structured)
    assert_equal 3, all_events.size
    assert_equal ["user", "plan", "execution"], all_events.map { |e| e["phase"] }
    
    # Verify plan has thought
    plan_payload = all_events[1]["payload"]
    assert_equal "I'll use find to search for Ruby files", plan_payload["thought"]
  end
end
