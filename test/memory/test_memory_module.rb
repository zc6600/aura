# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "tmpdir"

$LOAD_PATH.unshift File.expand_path("../../lib", __dir__)

require "aura/memory"

class TestMemoryModule < Minitest::Test
  def setup
    @test_dir = Dir.mktmpdir("aura_memory_test_")
  end

  def teardown
    FileUtils.remove_entry(@test_dir) if File.exist?(@test_dir)
  end

  def test_module_structure
    assert defined?(Aura::Memory)
    assert defined?(Aura::Memory::Base)
    assert defined?(Aura::Memory::Store)
    assert defined?(Aura::Memory::Stores::SQLiteStore)
    assert defined?(Aura::Memory::Recorder)
    assert defined?(Aura::Memory::Provider)
    assert defined?(Aura::Memory::Policy)
    assert defined?(Aura::Memory::Metabolizer)
    assert defined?(Aura::Memory::Config)
  end

  def test_sqlite_store_basic_operations
    store = Aura::Memory::Stores::SQLiteStore.new(project_path: @test_dir)

    event_id = store.insert_event(
      timestamp: Time.now.to_i,
      phase: "user",
      tool: nil,
      payload: { content: "Hello" }
    )
    assert event_id.is_a?(Integer)
    assert event_id > 0

    events = store.fetch_events
    assert_equal 1, events.size
    assert_equal "user", events[0]["phase"]
    assert_equal "Hello", events[0]["payload"]["content"]

    store.close
  end

  def test_recorder_interface
    store = Aura::Memory::Stores::SQLiteStore.new(project_path: @test_dir)
    recorder = Aura::Memory::Recorder.new(store)

    user_id = recorder.record_user("Test message")
    assert user_id.is_a?(Integer)

    plan_id = recorder.record_plan(tool: "read_file", args: {}, thought: "Thinking", summary: "Summary")
    assert plan_id.is_a?(Integer)

    exec_id = recorder.record_execution("read_file", { status: "ok" })
    assert exec_id.is_a?(Integer)

    events = store.fetch_events
    assert_equal 3, events.size
    assert_equal ["user", "plan", "execution"], events.map { |e| e["phase"] }

    store.close
  end

  def test_provider_interface
    store = Aura::Memory::Stores::SQLiteStore.new(project_path: @test_dir)
    recorder = Aura::Memory::Recorder.new(store)
    provider = Aura::Memory::Provider.new(store)

    recorder.record_user("Hello")
    recorder.record_plan(tool: "test", args: {}, thought: "Thought")

    events = provider.recent_events
    assert_equal 2, events.size

    context = provider.assemble_context
    assert context.key?(:events)
    assert context.key?(:summaries)
    assert context.key?(:variables)

    markdown = provider.to_markdown
    assert_includes markdown, "# AGENT STATE & MEMORY"

    store.close
  end

  def test_policy_basic
    policy = Aura::Memory::Policy.new

    event = { "phase" => "execution" }
    assert policy.should_summarize?(event)
    assert_equal :ephemeral, policy.tier_for(event)

    event = { "phase" => "milestone" }
    assert policy.permanent?(event)
    assert_equal :permanent, policy.tier_for(event)
  end

  def test_policy_apply
    policy = Aura::Memory::Policy.new

    events = [
      { "id" => 1, "phase" => "execution" },
      { "id" => 2, "phase" => "plan" },
      { "id" => 3, "phase" => "milestone" }
    ]

    result = policy.apply(events)
    assert_equal 1, result[:to_summarize].size
    assert_equal 2, result[:to_delete].size
    assert_equal 1, result[:to_keep].size
  end

  def test_config_from_hash
    config = Aura::Memory::Config.new(
      metabolism: { max_chars: 50_000, recent_events_n: 10 }
    )

    assert_equal 50_000, config.metabolism[:max_chars]
    assert_equal 10, config.metabolism[:recent_events_n]
    assert config.retention_policy.is_a?(Aura::Memory::Policy)
  end

  def test_base_initialization
    config = Aura::Memory::Config.new(store: { project_path: @test_dir })
    memory = Aura::Memory::Base.new(config: config)

    assert memory.recorder.is_a?(Aura::Memory::Recorder)
    assert memory.provider.is_a?(Aura::Memory::Provider)
    assert memory.metabolizer.is_a?(Aura::Memory::Metabolizer)
    assert memory.store.is_a?(Aura::Memory::Store)

    memory.store.close
  end

  def test_variables_operations
    store = Aura::Memory::Stores::SQLiteStore.new(project_path: @test_dir)

    store.set_variable(key: "test_key", value: "test_value")
    assert_equal "test_value", store.get_variable("test_key")

    store.set_variable(key: "another_key", value: "another_value")
    vars = store.all_variables
    assert_equal 2, vars.size
    assert_equal "test_value", vars["test_key"]
    assert_equal "another_value", vars["another_key"]

    store.close
  end

  def test_summaries_operations
    store = Aura::Memory::Stores::SQLiteStore.new(project_path: @test_dir)

    summary_id = store.insert_summary(content: "Test summary", source_event_id: 1)
    assert summary_id.is_a?(Integer)

    summaries = store.fetch_summaries
    assert_equal 1, summaries.size
    assert_equal "Test summary", summaries[0]["content"]
    assert_equal 1, summaries[0]["source_event_id"]

    store.close
  end

  def test_transaction_support
    store = Aura::Memory::Stores::SQLiteStore.new(project_path: @test_dir)

    store.transaction do
      store.insert_event(timestamp: Time.now.to_i, phase: "user", tool: nil, payload: { content: "In transaction" })
    end

    events = store.fetch_events
    assert_equal 1, events.size

    store.close
  end
end
