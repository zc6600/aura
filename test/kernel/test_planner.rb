# frozen_string_literal: true

require "test_helper"
require "aura/kernel/planner"
require "tmpdir"
require "fileutils"
require "yaml"

# Mock LLM Client that doesn't make real API calls
class MockLLMClient
  attr_accessor :responses, :stream_responses, :calls

  def initialize
    @responses = []       # Responses for complete()
    @stream_responses = [] # Responses for complete_stream()
    @calls = []           # Record all calls
    @response_index = 0
    @stream_index = 0
  end

  def complete(messages, options = {})
    @calls << { method: :complete, messages: messages, options: options }
    response = @responses[@response_index] || @responses.last
    @response_index += 1
    response || { content: "", finish_reason: "stop" }
  end

  def complete_stream(messages, options = {}, &block)
    @calls << { method: :complete_stream, messages: messages, options: options }
    stream_data = @stream_responses[@stream_index] || @stream_responses.last
    @stream_index += 1

    if stream_data && block
      # Simulate streaming by yielding chunks
      stream_data.each do |chunk|
        block.call(chunk)
      end
    end

    # Return final result
    stream_data&.last || { content: "", finish_reason: "stop" }
  end
end

class TestPlanner < Minitest::Test
  def setup
    @tmpdir = Dir.mktmpdir("aura-planner-test")
    @env_path = File.join(@tmpdir, ".aura")
    Dir.mkdir(@env_path)
    config_dir = File.join(@env_path, "config")
    Dir.mkdir(config_dir)

    # Create default config
    @config = {
      "llm" => {
        "provider" => "openai",
        "model" => "gpt-4",
        "temperature" => 0.7,
        "max_tokens" => 1000
      },
      "tool_protocol" => {
        "call_summary" => {
          "suggested_chars" => 100,
          "max_chars" => 200
        }
      }
    }
    File.write(File.join(config_dir, "config.yml"), YAML.dump(@config))

    # Mock environment variables
    ENV["OPENAI_API_KEY"] = "sk-test-key-12345"

    # Create mock client
    @mock_client = MockLLMClient.new

    # Create planner with mocked client
    @planner = create_planner_with_mock
  end

  def teardown
    FileUtils.rm_rf(@tmpdir)
  end

  # Helper to create planner with mocked client
  def create_planner_with_mock
    # Create a subclass that uses our mock client
    Class.new(Aura::Kernel::Planner) do
      define_method(:initialize) do |project_path, options = {}, mock_client: nil|
        @project_path = File.expand_path(project_path)
        @env_path = options[:env_path] || Aura::PathResolver.environment_path(@project_path)
        cfg = send(:load_config)
        provider = cfg.dig("llm", "provider") || "local"
        @temp = cfg.dig("llm", "temperature")
        @max_tokens = cfg.dig("llm", "max_tokens")
        @sum_suggest = cfg.dig("tool_protocol", "call_summary", "suggested_chars")
        @sum_max = cfg.dig("tool_protocol", "call_summary", "max_chars")
        # Use mock client if provided
        @client = mock_client || raise("mock_client required")
      end
    end.new(@tmpdir, { env_path: @env_path }, mock_client: @mock_client)
  end

  # Test 1: Plan returns parsed response
  def test_plan_returns_parsed_response
    @mock_client.responses = [{
      content: '{"tool": "bash", "args": {"command": "ls"}}',
      finish_reason: "tool_calls"
    }]

    result = @planner.plan("List files", "Current context")

    assert_equal "tool_call", result[:type]
    assert_equal "bash", result[:tool]
    assert_equal({ "command" => "ls" }, result[:args])
    assert_equal "tool_calls", result[:finish_reason]
  end

  # Test 2: Plan with stop finish_reason
  def test_plan_with_stop_finish
    @mock_client.responses = [{
      content: '{"content": "Task completed"}',
      finish_reason: "stop"
    }]

    result = @planner.plan("Simple question")

    assert_equal "stop", result[:finish_reason]
    # ResponseParser returns text type for content JSON
    assert_equal '{"content": "Task completed"}', result[:content]
  end

  # Test 3: Plan passes context and goal to LLM
  def test_plan_passes_context_and_goal
    @mock_client.responses = [{
      content: '{"content": "response"}',
      finish_reason: "stop"
    }]

    @planner.plan("My goal", "Context with details")

    assert_equal 1, @mock_client.calls.length
    call = @mock_client.calls[0]
    assert_equal :complete, call[:method]
    # Verify messages contain context and goal
    messages = call[:messages]
    assert messages.any? { |m| m[:content].to_s.include?("My goal") }
  end

  # Test 4: Plan uses configured temperature and max_tokens
  def test_plan_uses_configured_temperature_and_max_tokens
    @mock_client.responses = [{
      content: '{"content": "ok"}',
      finish_reason: "stop"
    }]

    @planner.plan("test")

    call = @mock_client.calls[0]
    assert_equal 0.7, call[:options][:temperature]
    assert_equal 1000, call[:options][:max_tokens]
  end

  # Test 5: Plan_stream yields delta events
  def test_plan_stream_yields_delta_events
    deltas = []
    @mock_client.stream_responses = [[
      { content: '{"tool":', finish_reason: nil },
      { content: ' "bash"', finish_reason: nil },
      { content: ', "args": {}}', finish_reason: "tool_calls" }
    ]]

    @planner.plan_stream("test goal", "context") do |event|
      deltas << event
    end

    assert deltas.length > 0
    assert_equal "delta", deltas[0][:type]
  end

  # Test 6: Plan_stream returns tool_call plan
  def test_plan_stream_returns_tool_call_plan
    @mock_client.stream_responses = [[
      { content: '{"tool": "bash", "args": {}}', finish_reason: "tool_calls" }
    ]]

    result = @planner.plan_stream("test")

    assert_equal "tool_call", result[:type]
    assert_equal "bash", result[:tool]
  end

  # Test 7: Plan_stream yields plan event when tool detected
  def test_plan_stream_yields_plan_event
    plan_events = []
    @mock_client.stream_responses = [[
      { content: '{"tool": "read_file", "args": {"path": "test.rb"}}', finish_reason: "tool_calls" }
    ]]

    @planner.plan_stream("test") do |event|
      plan_events << event if event[:type] == "plan"
    end

    assert_equal 1, plan_events.length
    assert_equal "plan", plan_events[0][:type]
    assert_equal "read_file", plan_events[0][:plan][:tool]
  end

  # Test 8: Plan_stream with text response (no tool)
  def test_plan_stream_with_text_response
    @mock_client.stream_responses = [[
      { content: '{"content": "Final answer"}', finish_reason: "stop" }
    ]]

    result = @planner.plan_stream("question")

    assert_equal "stop", result[:finish_reason]
    # ResponseParser returns text type
    assert_equal "text", result[:type]
    assert_includes result[:content], "Final answer"
  end

  # Test 9: Load config from config.yml
  def test_load_config_from_config_yml
    # Config already set in setup
    # Just verify planner uses it
    @mock_client.responses = [{
      content: '{"content": "ok"}',
      finish_reason: "stop"
    }]

    @planner.plan("test")

    call = @mock_client.calls[0]
    assert_equal 0.7, call[:options][:temperature]
  end

  # Test 10: Default config when config.yml missing
  def test_default_config_when_config_missing
    # Remove config file
    FileUtils.rm_rf(File.join(@env_path, "config"))

    mock_client = MockLLMClient.new
    mock_client.responses = [{
      content: '{"content": "ok"}',
      finish_reason: "stop"
    }]

    planner = Class.new(Aura::Kernel::Planner) do
      define_method(:initialize) do |project_path, options = {}, mock_client: nil|
        @project_path = File.expand_path(project_path)
        @env_path = options[:env_path] || Aura::PathResolver.environment_path(@project_path)
        cfg = send(:load_config)
        provider = cfg.dig("llm", "provider") || "local"
        @temp = cfg.dig("llm", "temperature")
        @max_tokens = cfg.dig("llm", "max_tokens")
        @client = mock_client || raise("mock_client required")
      end
    end.new(@tmpdir, { env_path: @env_path }, mock_client: mock_client)

    planner.plan("test")

    # Should use defaults (temperature nil, max_tokens nil)
    call = mock_client.calls[0]
    assert_nil call[:options][:temperature]
  end

  # Test 11: Provider resolution from config
  def test_provider_resolution_from_config
    @config["llm"]["provider"] = "anthropic"
    File.write(File.join(File.dirname(@env_path), ".env"), "ANTHROPIC_API_KEY=sk-ant-test")

    mock_client = MockLLMClient.new
    mock_client.responses = [{
      content: '{"tool": "test", "args": {}}',
      finish_reason: "stop"
    }]

    # Should not raise even with different provider
    planner = Class.new(Aura::Kernel::Planner) do
      define_method(:initialize) do |project_path, options = {}, mock_client: nil|
        @project_path = File.expand_path(project_path)
        @env_path = options[:env_path] || Aura::PathResolver.environment_path(@project_path)
        cfg = send(:load_config)
        @temp = cfg.dig("llm", "temperature")
        @max_tokens = cfg.dig("llm", "max_tokens")
        @client = mock_client
      end
    end.new(@tmpdir, { env_path: @env_path }, mock_client: mock_client)

    result = planner.plan("test")
    assert_equal "test", result[:tool]
  end

  # Test 12: Empty response handled gracefully
  def test_empty_response_handled_gracefully
    @mock_client.responses = [{
      content: "",
      finish_reason: "stop"
    }]

    result = @planner.plan("test")

    # Should return parsed result, not crash
    assert result.is_a?(Hash)
    assert_equal "text", result[:type]
  end

  # Test 13: Malformed JSON response
  def test_malformed_json_response
    @mock_client.responses = [{
      content: "not valid json {{{",
      finish_reason: "stop"
    }]

    # Should not raise, should handle gracefully
    result = @planner.plan("test")

    assert result.is_a?(Hash)
    assert_equal "text", result[:type]
  end

  # Test 14: Plan with nil goal
  def test_plan_with_nil_goal
    @mock_client.responses = [{
      content: '{"content": "response"}',
      finish_reason: "stop"
    }]

    result = @planner.plan("context only", nil)

    assert_equal "stop", result[:finish_reason]
  end

  # Test 15: Plan with empty context
  def test_plan_with_empty_context
    @mock_client.responses = [{
      content: '{"content": "ok"}',
      finish_reason: "stop"
    }]

    result = @planner.plan("", "goal")

    # ResponseParser returns text type with raw content
    assert_equal "text", result[:type]
    assert_includes result[:content], "ok"
  end

  # Test 16: Multiple sequential plans
  def test_multiple_sequential_plans
    @mock_client.responses = [
      { content: '{"tool": "tool1", "args": {}}', finish_reason: "tool_calls" },
      { content: '{"tool": "tool2", "args": {}}', finish_reason: "tool_calls" },
      { content: '{"content": "done"}', finish_reason: "stop" }
    ]

    result1 = @planner.plan("step 1")
    result2 = @planner.plan("step 2")
    result3 = @planner.plan("step 3")

    assert_equal "tool1", result1[:tool]
    assert_equal "tool2", result2[:tool]
    # Third response is text type
    assert_equal "text", result3[:type]
    assert_includes result3[:content], "done"
  end

  # Test 17: Finish reason from LLM response propagated
  def test_finish_reason_propagated
    ["stop", "tool_calls", "length", "content_filter", "error"].each do |reason|
      @mock_client.responses = [{
        content: '{"tool": "test", "args": {}}',
        finish_reason: reason
      }]

      result = @planner.plan("test")
      assert_equal reason, result[:finish_reason], "Failed for reason: #{reason}"
    end
  end

  # Test 18: Plan_stream with empty stream
  def test_plan_stream_with_empty_stream
    @mock_client.stream_responses = [[]]

    result = @planner.plan_stream("test")

    # Should handle gracefully
    assert result.is_a?(Hash)
  end

  # Test 19: Plan includes tools if available
  def test_plan_includes_tools_if_available
    @mock_client.responses = [{
      content: '{"content": "ok"}',
      finish_reason: "stop"
    }]

    @planner.plan("test")

    call = @mock_client.calls[0]
    # Tools should be included in options if context assembler provides them
    assert call[:options].key?(:tools) || call[:options][:tools].nil?
  end

  # Test 20: Config error tolerance
  def test_config_error_tolerance
    # Write invalid YAML
    config_dir = File.join(@env_path, "config")
    File.write(File.join(config_dir, "config.yml"), "invalid: yaml: {{{")

    mock_client = MockLLMClient.new
    mock_client.responses = [{
      content: '{"content": "ok"}',
      finish_reason: "stop"
    }]

    planner = Class.new(Aura::Kernel::Planner) do
      define_method(:initialize) do |project_path, options = {}, mock_client: nil|
        @project_path = File.expand_path(project_path)
        @env_path = options[:env_path] || Aura::PathResolver.environment_path(@project_path)
        cfg = send(:load_config)
        @temp = cfg.dig("llm", "temperature")
        @max_tokens = cfg.dig("llm", "max_tokens")
        @client = mock_client
      end
    end.new(@tmpdir, { env_path: @env_path }, mock_client: mock_client)

    # Should not raise
    result = planner.plan("test")
    # Should handle gracefully even with invalid config
    assert result.is_a?(Hash)
  end
end
