# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "tmpdir"

$LOAD_PATH.unshift File.expand_path("../../lib", __dir__)
require "aura/memory"

class TestMemoryBugs < Minitest::Test
  def setup
    @test_dir = Dir.mktmpdir("aura_memory_bugs_test_")
    @config = Aura::Memory::Config.new(store: { project_path: @test_dir })
    @memory = Aura::Memory::Base.new(config: @config)
  end

  def teardown
    @memory.store.close rescue nil
    FileUtils.remove_entry(@test_dir) if File.exist?(@test_dir)
  end

  def test_recent_events_returns_newest_in_chronological_order
    # Record 5 user events
    5.times do |i|
      @memory.recorder.record_user("User Event #{i}")
    end

    # Fetch with limit of 3
    events = @memory.provider.recent_events(limit: 3)
    
    assert_equal 3, events.size
    # It should return the 3 most recent events: 2, 3, 4
    assert_equal "User Event 2", events[0]["payload"]["content"]
    assert_equal "User Event 3", events[1]["payload"]["content"]
    assert_equal "User Event 4", events[2]["payload"]["content"]
    
    # IDs should be strictly ascending
    assert events[0]["id"] < events[1]["id"]
    assert events[1]["id"] < events[2]["id"]
  end

  def test_recent_summaries_returns_newest_in_chronological_order
    # Record 5 summaries
    5.times do |i|
      @memory.store.insert_summary(content: "Summary #{i}")
    end

    # Fetch with limit of 3
    summaries = @memory.provider.recent_summaries(limit: 3)

    assert_equal 3, summaries.size
    # It should return the 3 most recent summaries: 2, 3, 4
    assert_equal "Summary 2", summaries[0]["content"]
    assert_equal "Summary 3", summaries[1]["content"]
    assert_equal "Summary 4", summaries[2]["content"]

    # IDs should be strictly ascending
    assert summaries[0]["id"] < summaries[1]["id"]
    assert summaries[1]["id"] < summaries[2]["id"]
  end

  def test_old_events_excludes_recent_ones
    # Record 10 events
    10.times do |i|
      @memory.recorder.record_user("Event #{i}")
    end

    # Request old events keeping 3 recent ones
    old = @memory.provider.old_events(keep_recent: 3)

    assert_equal 7, old.size
    # It should contain Events 0 to 6
    assert_equal "Event 0", old.first["payload"]["content"]
    assert_equal "Event 6", old.last["payload"]["content"]
    
    # The 3 recent ones (Event 7, 8, 9) should NOT be in the returned list
    refute old.any? { |e| e["payload"]["content"] =~ /Event (7|8|9)/ }
  end

  def test_new_user_event_clears_undone_stack
    # 1. Record events
    @memory.recorder.record_user("User Event")
    @memory.recorder.record_execution("tool", { status: "ok" })

    # 2. Perform Undo
    assert @memory.undo, "Undo should succeed"

    # Verify they were moved to undone
    db = @memory.store.instance_variable_get(:@db)
    undone_count = db.get_first_value("SELECT COUNT(*) FROM undone_events").to_i
    assert undone_count > 0, "Undone stack should not be empty"

    # 3. Record a new user event
    @memory.recorder.record_user("New User Event")

    # Verify undone stack is now cleared
    undone_count = db.get_first_value("SELECT COUNT(*) FROM undone_events").to_i
    assert_equal 0, undone_count, "Undone stack should be cleared on new user event"
  end
end
