require "minitest/autorun"
require "aura"
require "aura/llm/client"
require "aura/errors"

class TestLlmFailover < Minitest::Test
  # Custom mock adapters for testing
  class MockSuccessAdapter
    attr_reader :api_key, :model
    def initialize(api_base:, api_key:, model:)
      @api_key = api_key
      @model = model
    end

    def complete(messages, options = {})
      { content: "Success (key: #{@api_key}, model: #{@model})", finish_reason: "stop" }
    end
  end

  class MockFailAdapter
    attr_reader :api_key, :model
    def initialize(api_base:, api_key:, model:)
      @api_key = api_key
      @model = model
    end

    def complete(messages, options = {})
      raise Aura::LLMError, "API Error on #{@model}"
    end
  end

  class MockTransientAdapter
    attr_accessor :fail_count, :call_count
    
    def initialize(api_base:, api_key:, model:)
      @api_key = api_key
      @model = model
      @fail_count = 2
      @call_count = 0
    end

    def complete(messages, options = {})
      @call_count += 1
      if @call_count <= @fail_count
        raise Aura::LLMError, "Transient API Error (attempt #{@call_count})"
      else
        { content: "Recovered (key: #{@api_key}, model: #{@model})", finish_reason: "stop" }
      end
    end
  end

  class MockStreamAdapter
    attr_reader :yield_then_fail
    def initialize(api_base:, api_key:, model:)
      @api_key = api_key
      @model = model
      @yield_then_fail = model == "yield_then_fail"
    end

    def complete_stream(messages, options = {})
      if @yield_then_fail
        yield("Part 1")
        raise Aura::LLMError, "Mid-stream error"
      else
        yield("Stream Success (key: #{@api_key}, model: #{@model})")
        { content: "Full Content", finish_reason: "stop" }
      end
    end
  end

  def setup
    Aura::LLM::Client.register_adapter("mock_success", MockSuccessAdapter)
    Aura::LLM::Client.register_adapter("mock_fail", MockFailAdapter)
    Aura::LLM::Client.register_adapter("mock_transient", MockTransientAdapter)
    Aura::LLM::Client.register_adapter("mock_stream", MockStreamAdapter)
  end

  def test_from_config_parses_backup_and_fallbacks
    config = {
      "provider" => "mock_success",
      "model" => "primary-model",
      "api_key" => "primary-key",
      "max_retries" => 3,
      "fallbacks" => [
        { "provider" => "mock_success", "model" => "fallback-model-1", "api_key" => "key-1" },
        { "provider" => "mock_success", "model" => "fallback-model-2", "api_key" => "key-2" }
      ]
    }

    client = Aura::LLM::Client.from_config(config)
    
    chain = client.configs_chain
    assert_equal 3, chain.length
    assert_equal "primary-model", chain[0][:model]
    assert_equal "fallback-model-1", chain[1][:model]
    assert_equal "fallback-model-2", chain[2][:model]
  end

  def test_from_config_supports_singular_backup
    config = {
      "provider" => "mock_success",
      "model" => "primary-model",
      "api_key" => "primary-key",
      "backup" => { "provider" => "mock_success", "model" => "backup-model", "api_key" => "backup-key" }
    }

    client = Aura::LLM::Client.from_config(config)
    
    chain = client.configs_chain
    assert_equal 2, chain.length
    assert_equal "primary-model", chain[0][:model]
    assert_equal "backup-model", chain[1][:model]
  end

  def test_transient_retry_success
    config = {
      "provider" => "mock_transient",
      "model" => "transient-model",
      "api_key" => "some-key",
      "max_retries" => 2
    }

    client = Aura::LLM::Client.from_config(config)
    
    # Mock sleep to avoid test execution delay
    client.define_singleton_method(:sleep) { |sec| }

    res = client.complete([{ role: "user", content: "hello" }])
    assert_equal "Recovered (key: some-key, model: transient-model)", res[:content]
  end

  def test_failover_when_primary_fails
    config = {
      "provider" => "mock_fail",
      "model" => "bad-primary",
      "api_key" => "primary-key",
      "max_retries" => 1,
      "fallbacks" => [
        { "provider" => "mock_success", "model" => "good-backup", "api_key" => "backup-key" }
      ]
    }

    client = Aura::LLM::Client.from_config(config)
    client.define_singleton_method(:sleep) { |sec| }

    res = client.complete([{ role: "user", content: "hello" }])
    
    # Verify we got the result from the backup provider
    assert_equal "Success (key: backup-key, model: good-backup)", res[:content]
  end

  def test_stream_failover_before_yielding
    config = {
      "provider" => "mock_fail",
      "model" => "bad-primary",
      "api_key" => "primary-key",
      "max_retries" => 1,
      "fallbacks" => [
        { "provider" => "mock_stream", "model" => "good-backup", "api_key" => "backup-key" }
      ]
    }

    client = Aura::LLM::Client.from_config(config)
    client.define_singleton_method(:sleep) { |sec| }

    yielded_chunks = []
    res = client.complete_stream([{ role: "user", content: "hello" }]) do |delta|
      yielded_chunks << delta
    end

    assert_equal ["Stream Success (key: backup-key, model: good-backup)"], yielded_chunks
  end

  def test_stream_error_raised_immediately_if_already_yielded
    config = {
      "provider" => "mock_stream",
      "model" => "yield_then_fail",
      "api_key" => "some-key",
      "max_retries" => 1,
      "fallbacks" => [
        { "provider" => "mock_stream", "model" => "should-not-be-reached", "api_key" => "backup-key" }
      ]
    }

    client = Aura::LLM::Client.from_config(config)
    client.define_singleton_method(:sleep) { |sec| }

    yielded_chunks = []
    
    assert_raises(Aura::LLMError) do
      client.complete_stream([{ role: "user", content: "hello" }]) do |delta|
        yielded_chunks << delta
      end
    end

    # The stream should have yielded "Part 1" before failing
    assert_equal ["Part 1"], yielded_chunks
  end
end
