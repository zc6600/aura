require "minitest/autorun"
require "aura"
require "aura/llm/client"
require "aura/errors"

class TestLlmFailover < Minitest::Test
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
    attr_reader :api_key, :model, :calls
    def initialize(api_base:, api_key:, model:)
      @api_key = api_key
      @model = model
      @calls = 0
    end

    def complete(messages, options = {})
      @calls += 1
      if @model == "auth_fail"
        raise Aura::LLMAuthError, "Auth fail"
      elsif @model == "bad_request_fail"
        raise Aura::LLMBadRequestError, "Bad Request parameters"
      elsif @model == "rate_limit_fail"
        raise Aura::LLMError, "LLM API Error (429): Rate limited"
      else
        raise Aura::LLMError, "API Error on #{@model}"
      end
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
        { "provider" => "mock_success", "model" => "fallback-model-1", "api_key" => "key-1", "max_retries" => 0 },
        { "provider" => "mock_success", "model" => "fallback-model-2", "api_key" => "key-2" }
      ]
    }

    client = Aura::LLM::Client.from_config(config)
    
    chain = client.configs_chain
    assert_equal 3, chain.length
    assert_equal "primary-model", chain[0][:model]
    assert_equal "fallback-model-1", chain[1][:model]
    assert_equal 0, chain[1][:max_retries]
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
    
    # Mock sleep to track sleep values and verify exponential backoff
    sleeps = []
    client.define_singleton_method(:sleep) { |sec| sleeps << sec }

    res = client.complete([{ role: "user", content: "hello" }])
    assert_equal "Recovered (key: some-key, model: transient-model)", res[:content]
    # Under exponential backoff, first sleep is 2**(1-1) = 1, second is 2**(2-1) = 2
    assert_equal [1, 2], sleeps
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

    assert_equal ["Part 1"], yielded_chunks
  end

  def test_non_retryable_errors
    config = {
      "provider" => "mock_fail",
      "model" => "auth_fail",
      "api_key" => "some-key",
      "max_retries" => 3,
      "fallbacks" => [
        { "provider" => "mock_success", "model" => "good-backup", "api_key" => "backup-key" }
      ]
    }

    client = Aura::LLM::Client.from_config(config)
    
    # We should immediately switch to fallback on Aura::LLMAuthError (no retries!)
    sleeps = []
    client.define_singleton_method(:sleep) { |sec| sleeps << sec }

    res = client.complete([{ role: "user", content: "hello" }])
    
    assert_equal "Success (key: backup-key, model: good-backup)", res[:content]
    assert_empty sleeps # No retries means no sleeps!
  end

  def test_non_retryable_bad_request_error
    config = {
      "provider" => "mock_fail",
      "model" => "bad_request_fail",
      "api_key" => "some-key",
      "max_retries" => 3,
      "fallbacks" => [
        { "provider" => "mock_success", "model" => "good-backup", "api_key" => "backup-key" }
      ]
    }

    client = Aura::LLM::Client.from_config(config)
    sleeps = []
    client.define_singleton_method(:sleep) { |sec| sleeps << sec }

    res = client.complete([{ role: "user", content: "hello" }])
    
    assert_equal "Success (key: backup-key, model: good-backup)", res[:content]
    assert_empty sleeps
  end

  def test_retryable_rate_limit_error
    config = {
      "provider" => "mock_fail",
      "model" => "rate_limit_fail",
      "api_key" => "some-key",
      "max_retries" => 1,
      "fallbacks" => [
        { "provider" => "mock_success", "model" => "good-backup", "api_key" => "backup-key" }
      ]
    }

    client = Aura::LLM::Client.from_config(config)
    sleeps = []
    client.define_singleton_method(:sleep) { |sec| sleeps << sec }

    res = client.complete([{ role: "user", content: "hello" }])
    
    assert_equal "Success (key: backup-key, model: good-backup)", res[:content]
    assert_equal [1], sleeps # Retried once, so slept once
  end

  def test_circuit_breaker_tripping_and_cooldown
    config = {
      "provider" => "mock_fail",
      "model" => "always_fail",
      "api_key" => "some-key",
      "max_retries" => 0,
      "fallbacks" => [
        { "provider" => "mock_success", "model" => "good-backup", "api_key" => "backup-key" }
      ]
    }

    client = Aura::LLM::Client.from_config(config)
    client.define_singleton_method(:sleep) { |sec| }

    # Call 1: fails primary, switches to backup (adds 1 failure)
    client.complete([{ role: "user", content: "hello" }])
    
    # Call 2: fails primary, switches to backup (adds 2 failures)
    client.complete([{ role: "user", content: "hello" }])

    # Call 3: fails primary, switches to backup (adds 3 failures -> trips!)
    client.complete([{ role: "user", content: "hello" }])

    # Access current adapter and ensure it is currently the backup success adapter
    assert_equal "good-backup", client.instance_variable_get(:@current_config)[:model]

    # Temporarily reset current adapter to primary to see if the circuit breaker skips it
    client.instance_variable_set(:@current_config, client.configs_chain[0])
    
    # Track the active adapter built during the call
    built_configs = []
    client.define_singleton_method(:build_adapter) do |cfg|
      built_configs << cfg
      super(cfg)
    end

    client.complete([{ role: "user", content: "hello" }])

    # The tripped primary model should be skipped entirely (not built or tried)
    refute_includes built_configs.map { |c| c[:model] }, "always_fail"
  end

  def test_per_fallback_max_retries
    config = {
      "provider" => "mock_fail",
      "model" => "primary",
      "api_key" => "some-key",
      "max_retries" => 0,
      "fallbacks" => [
        { "provider" => "mock_fail", "model" => "fallback-1", "api_key" => "some-key", "max_retries" => 2 },
        { "provider" => "mock_success", "model" => "good-backup", "api_key" => "backup-key" }
      ]
    }

    client = Aura::LLM::Client.from_config(config)
    
    sleeps = []
    client.define_singleton_method(:sleep) { |sec| sleeps << sec }

    res = client.complete([{ role: "user", content: "hello" }])
    
    assert_equal "Success (key: backup-key, model: good-backup)", res[:content]
    # Primary has 0 retries (0 sleeps).
    # Fallback-1 has 2 retries (2 sleeps: 2**0 = 1, 2**1 = 2).
    assert_equal [1, 2], sleeps
  end
end
