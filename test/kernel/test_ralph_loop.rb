# frozen_string_literal: true

require "test_helper"
require "tmpdir"
require "fileutils"
require "open3"
require "securerandom"
require "aura/kernel/ralph_loop"
require "aura/kernel/event_bus"

class TestRalphLoop < Minitest::Test
  class MockLLMClient
    attr_accessor :responses
    
    def initialize
      @responses = []
      @idx = 0
    end
    
    def complete(messages, options = {})
      res = @responses[@idx] || @responses.last
      @idx += 1
      res
    end
  end

  class MockPayload
    def to_tool_schemas
      []
    end
    def to_markdown_excluding(keys)
      "mock_workspace_state"
    end
  end

  class MockPlanner
    attr_reader :client, :temp, :max_tokens
    def initialize(client)
      @client = client
      @temp = 0.2
      @max_tokens = 4000
    end
  end

  class MockRunner
    attr_reader :planner, :events, :hooks, :project_path, :env_path
    
    def initialize(client, project_path)
      @client = client
      @project_path = project_path
      @env_path = File.join(project_path, ".aura")
      @planner = MockPlanner.new(client)
      @events = []
      @hooks = Aura::Kernel::Hooks.new
      @config = {
        "ralph" => {
          "max_steps" => 10,
          "verify_command" => "echo test",
          "use_critic" => false
        }
      }
    end
    
    def reconnect_session!(session_name)
      # Simulate physical SQLite DB and journal file creations to test cleanup logic
      db_dir = File.join(@env_path, "state", "sessions")
      FileUtils.mkdir_p(db_dir)
      File.write(File.join(db_dir, "#{session_name}.db"), "mock_sqlite_data")
      File.write(File.join(db_dir, "#{session_name}.db-journal"), "mock_sqlite_journal")
    end
    
    def observe
      MockPayload.new
    end
    
    def start_job(input:, auto_mode:)
    end
    
    def run_call(call)
      { "status" => "ok", "output" => "mock tool run ok" }
    end
    
    def end_job(status)
    end
    
    def emit(event, payload = {})
      @events << { event: event, payload: payload }
    end
    
    def load_config
      # Return a deep copy of config to prevent test pollution
      dup_cfg = @config.dup
      dup_cfg["ralph"] = @config["ralph"].dup
      dup_cfg
    end
    
    def set_config(key, subkey, value)
      @config[key] ||= {}
      @config[key][subkey] = value
    end

    def plan_stream(goal = nil, context = nil)
      res = @client.complete(nil)
      content = res[:content] || ""
      parsed = Aura::LLM::Parsers::ResponseParser.parse(res[:raw] || res[:content] || content)
      parsed[:finish_reason] = res[:finish_reason]
      parsed[:raw_content] = content
      
      # Yield delta event to simulate streaming if block given
      yield({ type: "delta", text: content }) if block_given?
      
      parsed
    end
  end

  class MockStatus
    def initialize(success_val)
      @success_val = success_val
    end
    def success?
      @success_val
    end
  end

  def setup
    @project_path = Dir.mktmpdir("aura_test")
    @env_path = File.join(@project_path, ".aura")
    FileUtils.mkdir_p(File.join(@env_path, "config"))
    
    # Write a base config.yml
    File.write(
      File.join(@env_path, "config", "config.yml"),
      <<~YAML
        ralph:
          max_steps: 10
          verify_command: "echo test"
          use_critic: false
        llm:
          provider: "local"
      YAML
    )
    
    @mock_client = MockLLMClient.new
    @mock_runner = MockRunner.new(@mock_client, @project_path)
  end

  def teardown
    FileUtils.rm_rf(@project_path)
  end

  # Helper to stub a singleton class method in pure Ruby
  def stub_singleton(klass, method_name, mock_value_or_callable)
    original_method = klass.method(method_name)
    klass.define_singleton_method(method_name) do |*args, &block|
      if mock_value_or_callable.respond_to?(:call)
        mock_value_or_callable.call(*args, &block)
      else
        mock_value_or_callable
      end
    end
    yield
  ensure
    klass.define_singleton_method(method_name, &original_method)
  end

  # Test 1: Completes immediately when physical test passes
  def test_physical_verify_passes_immediately
    @mock_client.responses = [
      { content: "Task completed successfully summarizing all modifications.", finish_reason: "stop" }
    ]
    
    mock_status = MockStatus.new(true)
    
    stub_singleton(Open3, :capture3, ["test output", "", mock_status]) do
      loop_inst = Aura::Kernel::RalphLoop.new(@mock_runner, "fix bug")
      result = loop_inst.run
      
      assert_equal :completed, result
    end
  end

  # Test 2: Fails first physical test, succeeds on second iteration
  def test_physical_verify_fails_once_then_succeeds
    @mock_client.responses = [
      { content: "First attempt at fixing", finish_reason: "stop" },
      { content: "Second attempt with verified result", finish_reason: "stop" }
    ]
    
    status_fail = MockStatus.new(false)
    status_ok = MockStatus.new(true)

    call_count = 0
    capture3_stub = lambda do |*args|
      call_count += 1
      if call_count <= 2
        ["failed test log", "some error", status_fail]
      else
        ["success log", "", status_ok]
      end
    end

    stub_singleton(Open3, :capture3, capture3_stub) do
      loop_inst = Aura::Kernel::RalphLoop.new(@mock_runner, "fix bug")
      result = loop_inst.run
      
      assert_equal :completed, result
      assert_equal 3, call_count
    end
  end

  # Test 3: Critic LLM rejects first attempt, accepts second attempt
  def test_critic_rejects_first_then_accepts
    @mock_client.responses = [
      { content: '{"tool": "read_file", "args": {"path": "a.txt"}, "summary": "reading"}', finish_reason: "tool_calls" },
      { content: '{"completed": false, "critique": "not fixed yet", "advice": "edit file"}', finish_reason: "stop" },
      { content: "fixed content", finish_reason: "stop" },
      { content: '{"completed": true, "critique": "perfect", "advice": ""}', finish_reason: "stop" }
    ]

    loop_inst = Aura::Kernel::RalphLoop.new(@mock_runner, "fix code", critic: true)
    result = loop_inst.run
    
    assert_equal :completed, result

    # Verify that the critique report was written to disk with a unique run_id filename
    run_id = loop_inst.instance_variable_get(:@run_id)
    audit_file = File.join(@env_path, "state", "critic_audit_#{run_id}_step_2.md")
    assert File.exist?(audit_file)
    audit_content = File.read(audit_file)
    assert_match(/PASSING/, audit_content)
    assert_match(/perfect/, audit_content)
  end

  # Test 4: Aborts when max steps limit is exceeded
  def test_aborts_on_max_steps
    @mock_client.responses = [
      { content: '{"tool": "read_file", "args": {"path": "a.txt"}, "summary": "looping"}', finish_reason: "tool_calls" }
    ] * 10
    
    loop_inst = Aura::Kernel::RalphLoop.new(@mock_runner, "endless goal", max_steps: 3)
    result = loop_inst.run
    
    assert_equal :failed, result
  end

  # Test 5: Safe hook cleanup and current_mode state checks
  def test_hook_cleanup_and_mode_transitions
    @mock_client.responses = [
      { content: "Finished goal", finish_reason: "stop" }
    ]
    mock_status = MockStatus.new(true)
    
    stub_singleton(Open3, :capture3, ["test output", "", mock_status]) do
      loop_inst = Aura::Kernel::RalphLoop.new(@mock_runner, "fix bug")
      
      # Verify hook is registered initially
      hooks_before = @mock_runner.hooks.instance_variable_get(:@hooks)[:before_planning]
      assert_includes hooks_before, loop_inst.instance_variable_get(:@planning_hook_proc)
      
      result = loop_inst.run
      assert_equal :completed, result
      
      # Verify hook is unregistered after run completes
      hooks_after = @mock_runner.hooks.instance_variable_get(:@hooks)[:before_planning]
      refute_includes hooks_after, loop_inst.instance_variable_get(:@planning_hook_proc)
      
      # Verify current_mode was reset to developer
      assert_equal :developer, loop_inst.instance_variable_get(:@current_mode)
    end
  end

  # Test 6: Verification command timeout handling
  def test_verification_command_timeout
    @mock_client.responses = [
      { content: "Finished", finish_reason: "stop" }
    ]
    
    # Configure timeout in mock runner cleanly
    @mock_runner.set_config("ralph", "timeout", 0.01)
    
    sleep_stub = lambda do |*args|
      sleep 0.5
      ["", "", MockStatus.new(true)]
    end
    
    stub_singleton(Open3, :capture3, sleep_stub) do
      loop_inst = Aura::Kernel::RalphLoop.new(@mock_runner, "fix bug", max_steps: 1)
      result = loop_inst.run
      
      # Since it times out, the test fails, and since max_steps is 1, the run fails
      assert_equal :failed, result
      assert_match(/timed out after/, loop_inst.instance_variable_get(:@last_test_feedback))
    end
  end

  # Test 7: Temporary session database cleanup verification
  def test_session_db_cleanup
    @mock_client.responses = [
      { content: "Finished", finish_reason: "stop" }
    ]
    mock_status = MockStatus.new(true)
    
    stub_singleton(Open3, :capture3, ["test output", "", mock_status]) do
      loop_inst = Aura::Kernel::RalphLoop.new(@mock_runner, "fix bug", max_steps: 2)
      loop_inst.run
      
      db_dir = File.join(@env_path, "state", "sessions")
      temp_dbs = Dir.glob(File.join(db_dir, "ralph_run_*"))
      assert_empty temp_dbs
    end
  end

  # Test 8: Concurrent loop audit file isolation
  def test_concurrent_loop_audit_isolation
    # Initialize two concurrent runs of RalphLoop
    loop_inst1 = Aura::Kernel::RalphLoop.new(@mock_runner, "run 1")
    loop_inst2 = Aura::Kernel::RalphLoop.new(@mock_runner, "run 2")
    
    # Explicitly run their setup to initialize run_ids
    loop_inst1.instance_variable_set(:@run_id, "RUN1_HEX")
    loop_inst2.instance_variable_set(:@run_id, "RUN2_HEX")
    loop_inst1.instance_variable_set(:@iteration_count, 1)
    loop_inst2.instance_variable_set(:@iteration_count, 1)
    
    loop_inst1.send(:write_critic_audit_file, "critique 1", "advice 1", false)
    loop_inst2.send(:write_critic_audit_file, "critique 2", "advice 2", false)
    
    # Assert both audit files exist and do not overwrite each other
    file1 = File.join(@env_path, "state", "critic_audit_RUN1_HEX_step_1.md")
    file2 = File.join(@env_path, "state", "critic_audit_RUN2_HEX_step_1.md")
    
    assert File.exist?(file1)
    assert File.exist?(file2)
    assert_match(/critique 1/, File.read(file1))
    assert_match(/critique 2/, File.read(file2))
  end

  # Test 9: Resilient exception handling in Developer Loop
  def test_loop_resilience_to_developer_loop_exceptions
    @mock_client.responses = [
      { content: "Attempt 2", finish_reason: "stop" }
    ]
    
    # Mock planning to raise an error during the first step
    call_count = 0
    plan_stream_stub = lambda do |*args|
      call_count += 1
      if call_count == 1
        raise StandardError.new("Transient LLM error")
      else
        res = @mock_client.complete(nil)
        content = res[:content] || ""
        parsed = Aura::LLM::Parsers::ResponseParser.parse(res[:raw] || res[:content] || content)
        parsed[:finish_reason] = res[:finish_reason]
        parsed[:raw_content] = content
        parsed
      end
    end
    
    mock_status = MockStatus.new(true)
    
    stub_singleton(@mock_runner, :plan_stream, plan_stream_stub) do
      stub_singleton(Open3, :capture3, ["test output", "", mock_status]) do
        loop_inst = Aura::Kernel::RalphLoop.new(@mock_runner, "fix bug", max_steps: 2)
        result = loop_inst.run
        
        # Verify it recovers on iteration 2 and completes successfully!
        assert_equal :completed, result
        assert_equal 2, call_count
      end
    end
  end
end
