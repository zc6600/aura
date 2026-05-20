# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "json"
require "aura/kernel"

class TestKernelContextFlow < Minitest::Test
  def setup
    @project = File.join(Dir.pwd, "tmp_integration_project")
    FileUtils.rm_rf(@project)
    system("ruby bin/aura new '#{@project}' > /dev/null")
    
    setup_browser_tool_group
    setup_config
  end

  def teardown
    FileUtils.rm_rf(@project)
  end

  def test_full_context_lifecycle
    runner = Aura::Kernel::Runner.new(@project)
    
    # 1. Create Context
    res_open = runner.run_call({
      "tool" => "browser_open",
      "args" => { "url" => "https://example.com" },
      "summary" => "Opening browser"
    })
    
    context_id = res_open["context_id"]
    assert context_id, "Should return context_id"
    
    contexts = load_contexts
    assert contexts[context_id], "Context should exist in state"
    assert_equal "browser_session", contexts[context_id]["type"]
    
    # 2. Use Subtool (updates activity)
    initial_last_used = contexts[context_id]["last_used_at"]
    sleep 1
    
    res_click = runner.run_call({
      "tool" => "browser_click",
      "args" => { "context_id" => context_id, "selector" => "button" },
      "summary" => "Clicking button"
    })
    
    assert res_click["success"]
    contexts = load_contexts
    assert Time.parse(contexts[context_id]["last_used_at"]) > Time.parse(initial_last_used), "Activity should be updated"
    
    # 3. Sliding TTL check
    # We'll simulate a very short TTL in config if needed, but here we just check logic.
    ctx = runner.observe
    assert_includes ctx, context_id, "Context should be active in prompt"
    
    # 4. Destroy Context
    res_close = runner.run_call({
      "tool" => "browser_close",
      "args" => { "context_id" => context_id },
      "summary" => "Closing browser"
    })
    
    assert res_close["success"]
    contexts = load_contexts
    refute contexts[context_id], "Context should be removed from state"
  end

  private

  def load_contexts
    state_file = File.join(@project, ".aura", "state", "tool_contexts.json")
    JSON.parse(File.read(state_file))["contexts"]
  end

  def setup_config
    cfg_path = File.join(@project, ".aura", "config", "config.yml")
    File.write(cfg_path, <<~YAML)
      tool_protocol:
        required_files:
          - manifest.json
          - test.py
    YAML
  end

  def setup_browser_tool_group
    browser_dir = File.join(@project, ".aura", "tools", "browser")
    FileUtils.mkdir_p(browser_dir)

    File.write(File.join(browser_dir, "group_manifest.json"), {
      group_name: "browser",
      entry_tool: "open",
      context: {
        name: "browser_session",
        multi_instance: true,
        lifecycle: { created_by: "open", destroyed_by: ["close"], ttl: { seconds: 10 } }
      },
      subtools: ["click", "close"]
    }.to_json)

    # open
    FileUtils.mkdir_p(File.join(browser_dir, "open"))
    File.write(File.join(browser_dir, "open", "manifest.json"), {
      name: "browser_open",
      creates_context: "browser_session",
      runtime: "ruby",
      entry: "logic.rb"
    }.to_json)
    File.write(File.join(browser_dir, "open", "logic.rb"), "require 'json'; puts({success: true, context_id: 'abc_123'}.to_json)")
    File.write(File.join(browser_dir, "open", "test.py"), "print('ok')")

    # click
    FileUtils.mkdir_p(File.join(browser_dir, "click"))
    File.write(File.join(browser_dir, "click", "manifest.json"), {
      name: "browser_click",
      requires_context: "browser_session",
      runtime: "ruby",
      entry: "logic.rb"
    }.to_json)
    File.write(File.join(browser_dir, "click", "logic.rb"), "require 'json'; puts({success: true}.to_json)")
    File.write(File.join(browser_dir, "click", "test.py"), "print('ok')")

    # close
    FileUtils.mkdir_p(File.join(browser_dir, "close"))
    File.write(File.join(browser_dir, "close", "manifest.json"), {
      name: "browser_close",
      requires_context: "browser_session",
      destroys_context: true,
      runtime: "ruby",
      entry: "logic.rb"
    }.to_json)
    File.write(File.join(browser_dir, "close", "logic.rb"), "require 'json'; puts({success: true}.to_json)")
    File.write(File.join(browser_dir, "close", "test.py"), "print('ok')")
  end
end
