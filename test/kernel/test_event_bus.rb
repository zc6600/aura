# frozen_string_literal: true

require "test_helper"
require "aura/kernel/event_bus"

class TestEventBus < Minitest::Test
  def setup
    @bus = Aura::Kernel::EventBus.new
  end

  # Test 1: Basic subscribe and emit
  def test_basic_subscribe_and_emit
    received = []
    @bus.subscribe(:test_event) { |payload| received << payload }

    @bus.emit(:test_event, message: "hello", value: 42)

    assert_equal 1, received.length
    assert_equal({ message: "hello", value: 42 }, received[0])
  end

  # Test 2: Multiple listeners for same event
  def test_multiple_listeners_for_same_event
    results = []
    @bus.subscribe(:event) { |payload| results << "listener1: #{payload[:msg]}" }
    @bus.subscribe(:event) { |payload| results << "listener2: #{payload[:msg]}" }

    @bus.emit(:event, msg: "test")

    assert_equal 2, results.length
    assert_includes results, "listener1: test"
    assert_includes results, "listener2: test"
  end

  # Test 3: Subscribe returns self for chaining
  def test_subscribe_returns_self_for_chaining
    result = @bus.subscribe(:event1) { }

    assert_equal @bus, result
  end

  # Test 4: Method chaining works
  def test_method_chaining
    received = []
    @bus.subscribe(:event1) { |p| received << [:event1, p] }
         .subscribe(:event2) { |p| received << [:event2, p] }

    @bus.emit(:event1, data: "a")
    @bus.emit(:event2, data: "b")

    assert_equal 2, received.length
    assert_equal [:event1, { data: "a" }], received[0]
    assert_equal [:event2, { data: "b" }], received[1]
  end

  # Test 5: Wildcard listener receives all events
  def test_wildcard_listener_receives_all_events
    all_events = []
    @bus.subscribe(:*) { |event, payload| all_events << [event, payload] }

    @bus.emit(:event_a, x: 1)
    @bus.emit(:event_b, y: 2)
    @bus.emit(:event_c, z: 3)

    assert_equal 3, all_events.length
    assert_equal [:event_a, { x: 1 }], all_events[0]
    assert_equal [:event_b, { y: 2 }], all_events[1]
    assert_equal [:event_c, { z: 3 }], all_events[2]
  end

  # Test 6: Wildcard and specific listeners both triggered
  def test_wildcard_and_specific_listeners_both_triggered
    specific = []
    wildcard = []

    @bus.subscribe(:my_event) { |payload| specific << payload }
    @bus.subscribe(:*) { |event, payload| wildcard << [event, payload] }

    @bus.emit(:my_event, data: "test")

    assert_equal 1, specific.length
    assert_equal 1, wildcard.length
    assert_equal({ data: "test" }, specific[0])
    assert_equal [:my_event, { data: "test" }], wildcard[0]
  end

  # Test 7: Listener error doesn't stop other listeners
  def test_listener_error_doesnt_stop_other_listeners
    results = []

    @bus.subscribe(:event) { raise "boom!" }
    @bus.subscribe(:event) { |payload| results << payload }

    # Should not raise
    @bus.emit(:event, msg: "should still work")

    assert_equal 1, results.length
    assert_equal({ msg: "should still work" }, results[0])
  end

  # Test 8: Wildcard listener error doesn't stop others
  def test_wildcard_listener_error_doesnt_stop_others
    specific = []
    wildcard = []

    @bus.subscribe(:*) { raise "wildcard error" }
    @bus.subscribe(:*) { |event, payload| wildcard << [event, payload] }
    @bus.subscribe(:event) { |payload| specific << payload }

    # Should not raise
    @bus.emit(:event, data: "test")

    assert_equal 1, specific.length
    assert_equal 1, wildcard.length
  end

  # Test 9: Emit with no listeners is safe
  def test_emit_with_no_listeners_is_safe
    # Should not raise
    @bus.emit(:nonexistent_event, data: "anything")
    assert true
  end

  # Test 10: Multiple emits accumulate
  def test_multiple_emits_accumulate
    counter = 0
    @bus.subscribe(:increment) { counter += 1 }

    5.times { @bus.emit(:increment) }

    assert_equal 5, counter
  end

  # Test 11: Different event types isolated
  def test_different_event_types_isolated
    event_a_count = 0
    event_b_count = 0

    @bus.subscribe(:event_a) { event_a_count += 1 }
    @bus.subscribe(:event_b) { event_b_count += 1 }

    3.times { @bus.emit(:event_a) }
    2.times { @bus.emit(:event_b) }

    assert_equal 3, event_a_count
    assert_equal 2, event_b_count
  end

  # Test 12: Payload with various data types
  def test_payload_with_various_data_types
    received = []
    @bus.subscribe(:complex) { |payload| received << payload }

    @bus.emit(:complex, **{
      string: "hello",
      number: 42,
      array: [1, 2, 3],
      hash: { nested: true },
      boolean: true,
      nil_value: nil
    })

    assert_equal 1, received.length
    assert_equal({
      string: "hello",
      number: 42,
      array: [1, 2, 3],
      hash: { nested: true },
      boolean: true,
      nil_value: nil
    }, received[0])
  end

  # Test 13: Unsubscribe by not keeping reference (no unsubscribe method)
  def test_no_unsubscribe_method
    # EventBus doesn't have unsubscribe, which is by design
    refute_respond_to @bus, :unsubscribe
  end

  # Test 14: Listener receives keyword arguments
  def test_listener_receives_keyword_arguments
    received_args = []
    @bus.subscribe(:test) { |payload| received_args << payload.keys }

    @bus.emit(:test, foo: "bar", baz: "qux")

    assert_equal 1, received_args.length
    assert_includes received_args[0], :foo
    assert_includes received_args[0], :baz
  end

  # Test 15: Empty payload
  def test_empty_payload
    received = []
    @bus.subscribe(:empty) { |payload| received << payload }

    @bus.emit(:empty)

    assert_equal 1, received.length
    assert_equal({}, received[0])
  end
end

class TestCallbackEventBus < Minitest::Test
  def setup
    @callbacks = {}
    @bus = Aura::Kernel::CallbackEventBus.new(@callbacks)
  end

  # Test 16: Plan event delta triggers on_token
  def test_plan_event_delta_triggers_on_token
    tokens = []
    @callbacks[:on_token] = ->(text) { tokens << text }

    @bus.emit(:plan_event, type: "delta", text: "Hello")
    @bus.emit(:plan_event, type: "delta", text: " World")

    assert_equal ["Hello", " World"], tokens
  end

  # Test 17: Final answer triggers on_final_answer
  def test_final_answer_triggers_on_final_answer
    answers = []
    @callbacks[:on_final_answer] = ->(content) { answers << content }

    @bus.emit(:final_answer, content: "Task completed!")

    assert_equal 1, answers.length
    assert_equal "Task completed!", answers[0]
  end

  # Test 18: Tool halted triggers on_warning
  def test_tool_halted_triggers_on_warning
    warnings = []
    @callbacks[:on_warning] = ->(msg) { warnings << msg }

    @bus.emit(:tool_halted, tool: "bash", status: "failed", advice: "Permission denied")

    assert_equal 1, warnings.length
    assert_match /Tool 'bash' halted \(failed\): Permission denied/, warnings[0]
  end

  # Test 19: Loop aborted triggers on_warning
  def test_loop_aborted_triggers_on_warning
    warnings = []
    @callbacks[:on_warning] = ->(msg) { warnings << msg }

    @bus.emit(:loop_aborted, reason: "Max steps reached")

    assert_equal 1, warnings.length
    assert_match /Agent loop aborted: Max steps reached/, warnings[0]
  end

  # Test 20: Missing callback is safe
  def test_missing_callback_is_safe
    # Should not raise even though callback not defined
    @bus.emit(:final_answer, content: "test")
    @bus.emit(:tool_halted, tool: "bash", status: "failed", advice: "error")
    @bus.emit(:loop_aborted, reason: "test")

    assert true
  end

  # Test 21: Plan event with non-delta type ignored
  def test_plan_event_non_delta_ignored
    tokens = []
    @callbacks[:on_token] = ->(text) { tokens << text }

    @bus.emit(:plan_event, type: "start")
    @bus.emit(:plan_event, type: "end")
    @bus.emit(:plan_event, type: "delta", text: "only this")

    assert_equal 1, tokens.length
    assert_equal "only this", tokens[0]
  end

  # Test 22: Multiple callbacks work together
  def test_multiple_callbacks_work_together
    tokens = []
    answers = []
    warnings = []

    @callbacks[:on_token] = ->(text) { tokens << text }
    @callbacks[:on_final_answer] = ->(content) { answers << content }
    @callbacks[:on_warning] = ->(msg) { warnings << msg }

    @bus.emit(:plan_event, type: "delta", text: "thinking")
    @bus.emit(:final_answer, content: "done")
    @bus.emit(:tool_halted, tool: "read", status: "blocked", advice: "not allowed")

    assert_equal ["thinking"], tokens
    assert_equal ["done"], answers
    assert_equal 1, warnings.length
  end

  # Test 23: Initialize with empty callbacks
  def test_initialize_with_empty_callbacks
    bus = Aura::Kernel::CallbackEventBus.new({})

    # Should not raise
    bus.emit(:final_answer, content: "test")
    assert true
  end

  # Test 24: Initialize with nil callbacks
  def test_initialize_with_nil_callbacks
    bus = Aura::Kernel::CallbackEventBus.new(nil)

    # Should not raise
    bus.emit(:final_answer, content: "test")
    assert true
  end
end

class TestNullEventBus < Minitest::Test
  # Test 25: NullEventBus ignores all emits
  def test_null_event_bus_ignores_all_emits
    bus = Aura::Kernel::NullEventBus.new

    # Should not raise, should do nothing
    bus.emit(:event1, data: "test")
    bus.emit(:event2, foo: "bar")
    bus.emit(:anything)

    assert true
  end

  # Test 26: NullEventBus with any arguments
  def test_null_event_bus_with_any_arguments
    bus = Aura::Kernel::NullEventBus.new

    # Various argument patterns
    bus.emit(:test)
    bus.emit(:test, a: 1)
    bus.emit(:test, a: 1, b: 2, c: 3)

    assert true
  end
end
