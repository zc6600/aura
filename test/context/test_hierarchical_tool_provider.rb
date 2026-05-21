# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "json"
require "time"
require "aura/context"

class TestHierarchicalToolProvider < Minitest::Test
  def setup
    @project = File.join(Dir.pwd, "tmp_hierarchical_tool_project")
    FileUtils.rm_rf(@project)
    FileUtils.mkdir_p(@project)
    setup_browser_tool_group
    setup_config
    setup_state_dir
  end

  def teardown
    FileUtils.rm_rf(@project)
  end

  # ============================================================
  # Test: Group manifest is recognized
  # ============================================================
  def test_recognizes_group_manifest
    # Entry tool should be available (auto_load: true)
    out = Aura::Context.assemble(@project, nil)
    assert_includes out, "browser_open"
    assert_includes out, "Open a new browser session"
  end

  # ============================================================
  # Test: Subtools NOT available when no active context
  # ============================================================
  def test_subtools_indexed_but_locked_without_context
    out = Aura::Context.assemble(@project, nil)
    # Subtools should NOT be in ACTIVE TOOLS section but should be in INDEX with [LOCKED]
    assert_includes out, "browser_click: Click on an element [LOCKED: Requires browser_session]"
    assert_includes out, "browser_input: Type into an input field [LOCKED: Requires browser_session]"
    assert_includes out, "browser_close: Close a browser session [LOCKED: Requires browser_session]"
  end

  # ============================================================
  # Test: Subtools available when context is active
  # ============================================================
  def test_subtools_available_with_active_context
    create_active_context("browser_abc123", "browser_session")
    
    out = Aura::Context.assemble(@project, nil)
    assert_includes out, "browser_click"
    assert_includes out, "browser_input"
    assert_includes out, "browser_close"
    assert_includes out, "browser_abc123"
  end

  # ============================================================
  # Test: Multiple context instances
  # ============================================================
  def test_multiple_context_instances
    create_active_context("browser_abc123", "browser_session")
    create_active_context("browser_def456", "browser_session")
    
    out = Aura::Context.assemble(@project, nil)
    assert_includes out, "browser_abc123"
    assert_includes out, "browser_def456"
  end

  # ============================================================
  # Test: Context expires by turns (TTL)
  # ============================================================
  def test_context_expires_by_turns
    create_active_context("browser_expired", "browser_session", {
      created_turn: 1,
      last_used_turn: 1
    })
    
    # Simulate current turn is 25 (TTL is 20 turns)
    out = Aura::Context.assemble(@project, nil, current_turn: 25)
    refute_includes out, "browser_expired"
  end

  # ============================================================
  # Test: Context expires by time (TTL)
  # ============================================================
  def test_context_expires_by_time
    expired_time = (Time.now - 700).iso8601  # 700 seconds ago (TTL is 600)
    create_active_context("browser_time_expired", "browser_session", {
      created_at: expired_time,
      last_used_at: expired_time,
      created_turn: 1,
      last_used_turn: 1
    })
    
    out = Aura::Context.assemble(@project, nil, current_turn: 5)
    refute_includes out, "browser_time_expired"
  end

  # ============================================================
  # Test: Context NOT expired when within limits
  # ============================================================
  def test_context_valid_within_limits
    recent_time = (Time.now - 60).iso8601  # 60 seconds ago
    create_active_context("browser_valid", "browser_session", {
      created_at: recent_time,
      last_used_at: recent_time,
      created_turn: 5,
      last_used_turn: 8
    })
    
    out = Aura::Context.assemble(@project, nil, current_turn: 10)
    assert_includes out, "browser_valid"
  end

  # ============================================================
  # Test: Subtool requires context_id parameter
  # ============================================================
  def test_subtool_requires_context_id
    create_active_context("browser_abc123", "browser_session")
    
    out = Aura::Context.assemble(@project, nil)
    assert_includes out, "context_id"
    assert_includes out, "required"
  end

  # ============================================================
  # Test: Flat tools still work (backward compatibility)
  # ============================================================
  def test_flat_tools_backward_compatible
    setup_flat_tool
    out = Aura::Context.assemble(@project, nil)
    assert_includes out, "simple_tool"
    assert_includes out, "A simple flat tool"
  end

  # ============================================================
  # Test: destroys_context field recognized
  # ============================================================
  def test_destroy_context_tool_marked
    create_active_context("browser_abc123", "browser_session")
    
    out = Aura::Context.assemble(@project, nil)
    # close tool should be available and marked as destroyer
    assert_includes out, "browser_close"
  end

  # ============================================================
  # Test: Context expires only when BOTH limits reached (policy: all)
  # ============================================================
  def test_context_expires_only_when_both_limits_reached_with_policy_all
    # TTL: 20 turns, 600 seconds. Policy: all
    setup_browser_tool_group_with_policy_all

    # 1. Turns exceeded, but time NOT exceeded -> Should NOT expire
    create_active_context("browser_turns_only", "browser_session_all", {
      created_turn: 1,
      last_used_turn: 1,
      created_at: Time.now.iso8601 # recent
    })
    out = Aura::Context.assemble(@project, nil, current_turn: 25)
    assert_includes out, "browser_turns_only"

    # 2. Time exceeded, but turns NOT exceeded -> Should NOT expire
    expired_time = (Time.now - 700).iso8601
    create_active_context("browser_time_only", "browser_session_all", {
      created_turn: 20,
      last_used_turn: 20,
      created_at: expired_time
    })
    out = Aura::Context.assemble(@project, nil, current_turn: 21) # current_turn - 20 = 1 < 20
    assert_includes out, "browser_time_only"

    # 3. BOTH exceeded -> Should expire
    expired_time = (Time.now - 700).iso8601
    create_active_context("browser_both_exceeded", "browser_session_all", {
      created_turn: 1,
      last_used_turn: 1,
      created_at: expired_time,
      last_used_at: expired_time
    })
    out = Aura::Context.assemble(@project, nil, current_turn: 25)
    refute_includes out, "browser_both_exceeded"
  end

  private

  def setup_browser_tool_group_with_policy_all
    browser_dir = File.join(@project, "tools", "browser_all")
    FileUtils.mkdir_p(browser_dir)
    File.write(File.join(browser_dir, "group_manifest.json"), {
      group_name: "browser_all",
      entry_tool: "open",
      context: {
        name: "browser_session_all",
        lifecycle: {
          ttl: { turns: 20, seconds: 600, policy: "all" }
        }
      },
      subtools: ["click"]
    }.to_json)
    # create open tool
    FileUtils.mkdir_p(File.join(browser_dir, "open"))
    File.write(File.join(browser_dir, "open", "manifest.json"), { name: "browser_open_all", creates_context: "browser_session_all" }.to_json)
    # create click tool
    FileUtils.mkdir_p(File.join(browser_dir, "click"))
    File.write(File.join(browser_dir, "click", "manifest.json"), { name: "browser_click_all", requires_context: "browser_session_all" }.to_json)
  end

  def setup_browser_tool_group
    browser_dir = File.join(@project, "tools", "browser")
    FileUtils.mkdir_p(browser_dir)

    # Group manifest
    File.write(File.join(browser_dir, "group_manifest.json"), {
      group_name: "browser",
      description: "Browser automation tools",
      entry_tool: "open",
      context: {
        name: "browser_session",
        multi_instance: true,
        lifecycle: {
          created_by: "open",
          destroyed_by: ["close"],
          ttl: {
            turns: 20,
            seconds: 600,
            policy: "any"
          }
        }
      },
      subtools: ["click", "input", "close"]
    }.to_json)

    # Entry tool: open
    open_dir = File.join(browser_dir, "open")
    FileUtils.mkdir_p(open_dir)
    File.write(File.join(open_dir, "manifest.json"), {
      name: "browser_open",
      description: "Open a new browser session",
      runtime: "python3",
      entry: "logic.py",
      test: "test.py",
      auto_load: true,
      creates_context: "browser_session",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string" }
        },
        required: []
      }
    }.to_json)
    File.write(File.join(open_dir, "logic.py"), "print('open')")
    File.write(File.join(open_dir, "test.py"), "print('ok')")

    # Subtool: click
    click_dir = File.join(browser_dir, "click")
    FileUtils.mkdir_p(click_dir)
    File.write(File.join(click_dir, "manifest.json"), {
      name: "browser_click",
      description: "Click on an element",
      runtime: "python3",
      entry: "logic.py",
      test: "test.py",
      requires_context: "browser_session",
      input_schema: {
        type: "object",
        properties: {
          context_id: { type: "string" },
          selector: { type: "string" }
        },
        required: ["context_id", "selector"]
      }
    }.to_json)
    File.write(File.join(click_dir, "logic.py"), "print('click')")
    File.write(File.join(click_dir, "test.py"), "print('ok')")

    # Subtool: input
    input_dir = File.join(browser_dir, "input")
    FileUtils.mkdir_p(input_dir)
    File.write(File.join(input_dir, "manifest.json"), {
      name: "browser_input",
      description: "Type into an input field",
      runtime: "python3",
      entry: "logic.py",
      test: "test.py",
      requires_context: "browser_session",
      input_schema: {
        type: "object",
        properties: {
          context_id: { type: "string" },
          selector: { type: "string" },
          text: { type: "string" }
        },
        required: ["context_id", "selector", "text"]
      }
    }.to_json)
    File.write(File.join(input_dir, "logic.py"), "print('input')")
    File.write(File.join(input_dir, "test.py"), "print('ok')")

    # Subtool: close (destroyer)
    close_dir = File.join(browser_dir, "close")
    FileUtils.mkdir_p(close_dir)
    File.write(File.join(close_dir, "manifest.json"), {
      name: "browser_close",
      description: "Close a browser session",
      runtime: "python3",
      entry: "logic.py",
      test: "test.py",
      requires_context: "browser_session",
      destroys_context: true,
      input_schema: {
        type: "object",
        properties: {
          context_id: { type: "string" }
        },
        required: ["context_id"]
      }
    }.to_json)
    File.write(File.join(close_dir, "logic.py"), "print('close')")
    File.write(File.join(close_dir, "test.py"), "print('ok')")
  end

  def setup_flat_tool
    tool_dir = File.join(@project, "tools", "simple_tool")
    FileUtils.mkdir_p(tool_dir)
    File.write(File.join(tool_dir, "manifest.json"), {
      name: "simple_tool",
      description: "A simple flat tool",
      runtime: "python3",
      entry: "logic.py",
      test: "test.py",
      auto_load: true,
      input_schema: {
        type: "object",
        properties: {
          input: { type: "string" }
        },
        required: ["input"]
      }
    }.to_json)
    File.write(File.join(tool_dir, "logic.py"), "print('simple')")
    File.write(File.join(tool_dir, "test.py"), "print('ok')")
  end

  def setup_config
    FileUtils.mkdir_p(File.join(@project, "config"))
    File.write(File.join(@project, "config", "config.yml"), <<~YAML)
      tool_protocol:
        required_files:
          - logic.py
          - manifest.json
          - test.py
      state_management:
        max_state_chars: 10000
    YAML
  end

  def setup_state_dir
    FileUtils.mkdir_p(File.join(@project, "state"))
    File.write(File.join(@project, "state", "tool_contexts.json"), {
      contexts: {}
    }.to_json)
  end

  def create_active_context(context_id, context_type, overrides = {})
    state_file = File.join(@project, "state", "tool_contexts.json")
    state = JSON.parse(File.read(state_file))
    
    now = Time.now.iso8601
    state["contexts"][context_id] = {
      "type" => context_type,
      "created_at" => overrides[:created_at] || now,
      "created_turn" => overrides[:created_turn] || 1,
      "last_used_turn" => overrides[:last_used_turn] || 1,
      "last_used_at" => overrides[:last_used_at] || now,
      "data" => overrides[:data] || {}
    }
    
    File.write(state_file, JSON.pretty_generate(state))
  end
end
