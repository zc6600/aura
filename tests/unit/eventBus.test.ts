import { describe, it, expect } from 'vitest';
import { EventBus, CallbackEventBus, NullEventBus } from '../../src/core/memory/eventBus.js';

describe('EventBus (MemoryEventBus)', () => {
  it('test_basic_subscribe_and_emit', () => {
    const bus = new EventBus();
    const received: any[] = [];
    bus.subscribe('test_event', (payload) => {
      received.push(payload);
    });

    bus.emit('test_event', { message: 'hello', value: 42 });

    expect(received.length).toBe(1);
    expect(received[0]).toEqual({ message: 'hello', value: 42 });
  });

  it('test_multiple_listeners_for_same_event', () => {
    const bus = new EventBus();
    const results: string[] = [];
    bus.subscribe('event', (payload: any) => results.push(`listener1: ${payload.msg}`));
    bus.subscribe('event', (payload: any) => results.push(`listener2: ${payload.msg}`));

    bus.emit('event', { msg: 'test' });

    expect(results.length).toBe(2);
    expect(results).toContain('listener1: test');
    expect(results).toContain('listener2: test');
  });

  it('test_subscribe_returns_self_for_chaining', () => {
    const bus = new EventBus();
    const result = bus.subscribe('event1', () => {});
    expect(result).toBe(bus);
  });

  it('test_method_chaining', () => {
    const bus = new EventBus();
    const received: any[] = [];
    bus.subscribe('event1', (p) => received.push(['event1', p]))
       .subscribe('event2', (p) => received.push(['event2', p]));

    bus.emit('event1', { data: 'a' });
    bus.emit('event2', { data: 'b' });

    expect(received.length).toBe(2);
    expect(received[0]).toEqual(['event1', { data: 'a' }]);
    expect(received[1]).toEqual(['event2', { data: 'b' }]);
  });

  it('test_wildcard_listener_receives_all_events', () => {
    const bus = new EventBus();
    const all_events: any[] = [];
    bus.subscribe('*', (event, payload) => {
      all_events.push([event, payload]);
    });

    bus.emit('event_a', { x: 1 });
    bus.emit('event_b', { y: 2 });
    bus.emit('event_c', { z: 3 });

    expect(all_events.length).toBe(3);
    expect(all_events[0]).toEqual(['event_a', { x: 1 }]);
    expect(all_events[1]).toEqual(['event_b', { y: 2 }]);
    expect(all_events[2]).toEqual(['event_c', { z: 3 }]);
  });

  it('test_wildcard_and_specific_listeners_both_triggered', () => {
    const bus = new EventBus();
    const specific: any[] = [];
    const wildcard: any[] = [];

    bus.subscribe('my_event', (payload) => specific.push(payload));
    bus.subscribe('*', (event, payload) => wildcard.push([event, payload]));

    bus.emit('my_event', { data: 'test' });

    expect(specific.length).toBe(1);
    expect(wildcard.length).toBe(1);
    expect(specific[0]).toEqual({ data: 'test' });
    expect(wildcard[0]).toEqual(['my_event', { data: 'test' }]);
  });

  it('test_listener_error_doesnt_stop_other_listeners', () => {
    const bus = new EventBus();
    const results: any[] = [];

    bus.subscribe('event', () => { throw new Error('boom!'); });
    bus.subscribe('event', (payload) => results.push(payload));

    // Should not throw
    expect(() => bus.emit('event', { msg: 'should still work' })).not.toThrow();

    expect(results.length).toBe(1);
    expect(results[0]).toEqual({ msg: 'should still work' });
  });

  it('test_wildcard_listener_error_doesnt_stop_others', () => {
    const bus = new EventBus();
    const specific: any[] = [];
    const wildcard: any[] = [];

    bus.subscribe('*', () => { throw new Error('wildcard error'); });
    bus.subscribe('*', (event, payload) => wildcard.push([event, payload]));
    bus.subscribe('event', (payload) => specific.push(payload));

    // Should not throw
    expect(() => bus.emit('event', { data: 'test' })).not.toThrow();

    expect(specific.length).toBe(1);
    expect(wildcard.length).toBe(1);
  });

  it('test_emit_with_no_listeners_is_safe', () => {
    const bus = new EventBus();
    expect(() => bus.emit('nonexistent_event', { data: 'anything' })).not.toThrow();
  });

  it('test_multiple_emits_accumulate', () => {
    const bus = new EventBus();
    let counter = 0;
    bus.subscribe('increment', () => { counter += 1; });

    for (let i = 0; i < 5; i++) {
      bus.emit('increment');
    }

    expect(counter).toBe(5);
  });

  it('test_different_event_types_isolated', () => {
    const bus = new EventBus();
    let event_a_count = 0;
    let event_b_count = 0;

    bus.subscribe('event_a', () => { event_a_count += 1; });
    bus.subscribe('event_b', () => { event_b_count += 1; });

    for (let i = 0; i < 3; i++) bus.emit('event_a');
    for (let i = 0; i < 2; i++) bus.emit('event_b');

    expect(event_a_count).toBe(3);
    expect(event_b_count).toBe(2);
  });

  it('test_payload_with_various_data_types', () => {
    const bus = new EventBus();
    const received: any[] = [];
    bus.subscribe('complex', (payload) => received.push(payload));

    const payload = {
      string: 'hello',
      number: 42,
      array: [1, 2, 3],
      hash: { nested: true },
      boolean: true,
      nil_value: null,
    };
    bus.emit('complex', payload);

    expect(received.length).toBe(1);
    expect(received[0]).toEqual(payload);
  });

  it('test_listener_receives_keys', () => {
    const bus = new EventBus();
    const received_args: string[][] = [];
    bus.subscribe('test', (payload) => received_args.push(Object.keys(payload)));

    bus.emit('test', { foo: 'bar', baz: 'qux' });

    expect(received_args.length).toBe(1);
    expect(received_args[0]).toContain('foo');
    expect(received_args[0]).toContain('baz');
  });

  it('test_empty_payload', () => {
    const bus = new EventBus();
    const received: any[] = [];
    bus.subscribe('empty', (payload) => received.push(payload));

    bus.emit('empty');

    expect(received.length).toBe(1);
    expect(received[0]).toEqual({});
  });
});

describe('CallbackEventBus', () => {
  it('test_plan_event_delta_triggers_on_token', () => {
    const tokens: string[] = [];
    const callbacks = {
      on_token: (text: string) => tokens.push(text),
    };
    const bus = new CallbackEventBus(callbacks);

    bus.emit('plan_event', { type: 'delta', text: 'Hello' });
    bus.emit('plan_event', { type: 'delta', text: ' World' });

    expect(tokens).toEqual(['Hello', ' World']);
  });

  it('test_final_answer_triggers_on_final_answer', () => {
    const answers: string[] = [];
    const callbacks = {
      on_final_answer: (content: string) => answers.push(content),
    };
    const bus = new CallbackEventBus(callbacks);

    bus.emit('final_answer', { content: 'Task completed!' });

    expect(answers.length).toBe(1);
    expect(answers[0]).toBe('Task completed!');
  });

  it('test_tool_halted_triggers_on_warning', () => {
    const warnings: string[] = [];
    const callbacks = {
      on_warning: (msg: string) => warnings.push(msg),
    };
    const bus = new CallbackEventBus(callbacks);

    bus.emit('tool_halted', { tool: 'bash', status: 'failed', advice: 'Permission denied' });

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/Tool 'bash' halted \(failed\): Permission denied/);
  });

  it('test_loop_aborted_triggers_on_warning', () => {
    const warnings: string[] = [];
    const callbacks = {
      on_warning: (msg: string) => warnings.push(msg),
    };
    const bus = new CallbackEventBus(callbacks);

    bus.emit('loop_aborted', { reason: 'Max steps reached' });

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/Agent loop aborted: Max steps reached/);
  });

  it('test_missing_callback_is_safe', () => {
    const bus = new CallbackEventBus({});
    expect(() => {
      bus.emit('final_answer', { content: 'test' });
      bus.emit('tool_halted', { tool: 'bash', status: 'failed', advice: 'error' });
      bus.emit('loop_aborted', { reason: 'test' });
    }).not.toThrow();
  });

  it('test_plan_event_non_delta_ignored', () => {
    const tokens: string[] = [];
    const callbacks = {
      on_token: (text: string) => tokens.push(text),
    };
    const bus = new CallbackEventBus(callbacks);

    bus.emit('plan_event', { type: 'start' });
    bus.emit('plan_event', { type: 'end' });
    bus.emit('plan_event', { type: 'delta', text: 'only this' });

    expect(tokens.length).toBe(1);
    expect(tokens[0]).toBe('only this');
  });

  it('test_multiple_callbacks_work_together', () => {
    const tokens: string[] = [];
    const answers: string[] = [];
    const warnings: string[] = [];

    const callbacks = {
      on_token: (text: string) => tokens.push(text),
      on_final_answer: (content: string) => answers.push(content),
      on_warning: (msg: string) => warnings.push(msg),
    };
    const bus = new CallbackEventBus(callbacks);

    bus.emit('plan_event', { type: 'delta', text: 'thinking' });
    bus.emit('final_answer', { content: 'done' });
    bus.emit('tool_halted', { tool: 'read', status: 'blocked', advice: 'not allowed' });

    expect(tokens).toEqual(['thinking']);
    expect(answers).toEqual(['done']);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/Tool 'read' halted \(blocked\): not allowed/);
  });

  it('test_initialize_with_empty_callbacks', () => {
    const bus = new CallbackEventBus({});
    expect(() => bus.emit('final_answer', { content: 'test' })).not.toThrow();
  });

  it('test_initialize_with_nil_callbacks', () => {
    const bus = new CallbackEventBus(null);
    expect(() => bus.emit('final_answer', { content: 'test' })).not.toThrow();
  });
});

describe('NullEventBus', () => {
  it('test_null_event_bus_ignores_all_emits', () => {
    const bus = new NullEventBus();
    expect(() => {
      bus.emit('event1', { data: 'test' });
      bus.emit('event2', { foo: 'bar' });
      bus.emit('anything');
    }).not.toThrow();
  });

  it('test_null_event_bus_with_any_arguments', () => {
    const bus = new NullEventBus();
    expect(() => {
      bus.emit('test');
      bus.emit('test', { a: 1 });
      bus.emit('test', { a: 1, b: 2, c: 3 });
    }).not.toThrow();
  });
});
