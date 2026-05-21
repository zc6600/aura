# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "aura/context/session_manager"

class TestSessionManager < Minitest::Test
  def setup
    @test_dir = File.expand_path("tmp_test_session_manager", __dir__)
    FileUtils.rm_rf(@test_dir)
    FileUtils.mkdir_p(@test_dir)
    @manager = Aura::Context::SessionManager.new(@test_dir)
  end

  def teardown
    FileUtils.rm_rf(@test_dir)
  end

  def test_create_session
    session = @manager.create("test-session", description: "Test session")
    
    assert_equal "test-session", session[:name]
    assert_includes session[:db_path], "test-session.db"
    assert session[:created_at]
    assert_equal "Test session", session[:description]
    assert @manager.exists?("test-session")
  end

  def test_create_duplicate_session
    @manager.create("session-a")
    assert_raises(ArgumentError) do
      @manager.create("session-a")
    end
  end

  def test_activate_session
    @manager.create("session-b")
    db_path = @manager.activate("session-b")
    
    assert_includes db_path, "session-b.db"
    assert_equal "session-b", @manager.current_name
    assert_equal "session-b", ENV["AURA_SESSION_NAME"]
  end

  def test_activate_nonexistent_session
    assert_raises(ArgumentError) do
      @manager.activate("nonexistent")
    end
  end

  def test_list_sessions
    @manager.create("session-1")
    @manager.create("session-2")
    
    sessions = @manager.list
    
    assert_equal 2, sessions.size
    assert sessions.any? { |s| s[:name] == "session-1" }
    assert sessions.any? { |s| s[:name] == "session-2" }
  end

  def test_delete_session
    @manager.create("to-delete")
    assert @manager.exists?("to-delete")
    
    @manager.delete("to-delete")
    refute @manager.exists?("to-delete")
  end

  def test_rename_session
    @manager.create("old-name")
    @manager.rename("old-name", "new-name")
    
    refute @manager.exists?("old-name")
    assert @manager.exists?("new-name")
  end

  def test_rename_updates_active_session
    @manager.create("old-name")
    @manager.activate("old-name")
    assert_equal "old-name", @manager.current_name
    
    @manager.rename("old-name", "renamed")
    assert_equal "renamed", @manager.current_name
  end

  def test_duplicate_session
    @manager.create("original")
    
    # Add some data to original session
    db_path = @manager.send(:db_path_for, "original")
    require "sqlite3"
    db = SQLite3::Database.new(db_path)
    db.execute("INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)",
               [Time.now.to_i, "user", nil, {content: "test"}.to_json])
    db.close
    
    @manager.duplicate("original", "copy")
    
    assert @manager.exists?("copy")
    
    # Verify data was copied
    copy_db_path = @manager.send(:db_path_for, "copy")
    copy_db = SQLite3::Database.new(copy_db_path)
    count = copy_db.get_first_value("SELECT COUNT(*) FROM events")
    assert_equal 1, count
    copy_db.close
  end

  def test_export_and_import
    @manager.create("export-me")
    
    export_path = File.join(@test_dir, "exported.db")
    @manager.export("export-me", export_path)
    assert File.exist?(export_path)
    
    @manager.import(export_path, "imported")
    assert @manager.exists?("imported")
  end

  def test_session_isolation
    # Create two sessions
    @manager.create("session-a")
    @manager.create("session-b")
    
    db_a = @manager.send(:db_path_for, "session-a")
    db_b = @manager.send(:db_path_for, "session-b")
    
    # Add data to session A
    require "sqlite3"
    db = SQLite3::Database.new(db_a)
    db.execute("INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)",
               [Time.now.to_i, "user", nil, {content: "data for A"}.to_json])
    db.close
    
    # Session B should be empty
    db = SQLite3::Database.new(db_b)
    count = db.get_first_value("SELECT COUNT(*) FROM events")
    assert_equal 0, count
    db.close
  end

  def test_validate_session_name
    assert_raises(ArgumentError) do
      @manager.create("")
    end
    
    assert_raises(ArgumentError) do
      @manager.create("bad/name")
    end
    
    assert_raises(ArgumentError) do
      @manager.create("bad..name")
    end
  end

  def test_list_includes_stats
    @manager.create("with-stats")
    
    # Add some events
    db_path = @manager.send(:db_path_for, "with-stats")
    require "sqlite3"
    db = SQLite3::Database.new(db_path)
    3.times do |i|
      db.execute("INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)",
                 [Time.now.to_i, "user", nil, {content: "event #{i}"}.to_json])
    end
    db.close
    
    sessions = @manager.list
    stats_session = sessions.find { |s| s[:name] == "with-stats" }
    
    assert_equal 3, stats_session[:event_count]
    assert stats_session[:turn_count] > 0
  end

  def test_integration_with_state_class
    # This tests the full integration pattern
    
    # Create and activate session
    @manager.create("integration-test")
    @manager.activate("integration-test")
    
    # Now State class should pick up this session
    require "aura/kernel/state"
    state = Aura::Kernel::State.new(@test_dir)
    
    # State should use the correct db
    assert_includes state.instance_variable_get(:@db_path), "integration-test.db"
    
    # Record an event
    state.record_event({ phase: "user", content: "Hello from integration test" })
    
    # Verify it's in the session's db
    db_path = @manager.send(:db_path_for, "integration-test")
    require "sqlite3"
    db = SQLite3::Database.new(db_path)
    count = db.get_first_value("SELECT COUNT(*) FROM events WHERE phase = 'user'")
    assert_equal 1, count
    db.close
  end
end
