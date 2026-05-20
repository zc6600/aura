require "minitest/autorun"
require "aura/llm/client"

class TestNewAdapters < Minitest::Test
  def teardown
    if @orig_start
      Net::HTTP.singleton_class.define_method(:start, @orig_start)
    end
  end

  def test_deepseek_adapter_default_endpoint_and_routing
    require "aura/llm/adapters/deepseek"
    adapter = Aura::LLM::Adapters::DeepSeek.new(api_base: nil, api_key: "ds-key", model: nil)
    # Check that default api_base and model are set correctly
    assert_equal "https://api.deepseek.com/v1/chat/completions", adapter.instance_variable_get(:@api_base)
    assert_equal "deepseek-chat", adapter.instance_variable_get(:@model)

    # Test client initialization
    client = Aura::LLM::Client.new(provider: "deepseek", api_key: "ds-key")
    underlying = client.send(:build_adapter)
    assert_kind_of Aura::LLM::Adapters::DeepSeek, underlying
  end

  def test_gemini_adapter_default_endpoint_and_routing
    require "aura/llm/adapters/gemini"
    adapter = Aura::LLM::Adapters::Gemini.new(api_base: nil, api_key: "gem-key", model: nil)
    assert_equal "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", adapter.instance_variable_get(:@api_base)
    assert_equal "gemini-1.5-flash", adapter.instance_variable_get(:@model)

    # Test client initialization
    client = Aura::LLM::Client.new(provider: "gemini", api_key: "gem-key")
    underlying = client.send(:build_adapter)
    assert_kind_of Aura::LLM::Adapters::Gemini, underlying
  end

  def test_anthropic_adapter_and_system_prompt_routing
    require "aura/llm/adapters/anthropic"
    adapter = Aura::LLM::Adapters::Anthropic.new(api_base: nil, api_key: "ant-key", model: nil)
    assert_equal "https://api.anthropic.com/v1/messages", adapter.instance_variable_get(:@api_base)
    assert_equal "claude-3-5-sonnet-20241022", adapter.instance_variable_get(:@model)

    # Test client initialization
    client = Aura::LLM::Client.new(provider: "anthropic", api_key: "ant-key")
    underlying = client.send(:build_adapter)
    assert_kind_of Aura::LLM::Adapters::Anthropic, underlying

    # Mock HTTP start to test system extraction and response parsing
    @orig_start = Net::HTTP.method(:start)
    captured_headers = {}
    captured_body = nil

    fake_http = Class.new do
      define_method(:initialize) do |headers_hash, body_ref|
        @headers = headers_hash
        @body_ref = body_ref
      end

      define_method(:request) do |req|
        @headers["x-api-key"] = req["x-api-key"]
        @headers["anthropic-version"] = req["anthropic-version"]
        @body_ref.replace(req.body)

        # Fake response
        response_body = {
          content: [
            { type: "text", text: "CLAUDE_REPLY" }
          ]
        }.to_json
        Struct.new(:body).new(response_body)
      end
    end

    body_str = +""
    Net::HTTP.singleton_class.class_eval do
      define_method(:start) do |host, port, opts, &blk|
        blk.call(fake_http.new(captured_headers, body_str))
      end
    end

    messages = [
      { role: "system", content: "SYS_RULE" },
      { role: "user", content: "hello" }
    ]
    out = adapter.complete(messages, {})

    # Assertions on captured request
    assert_equal "ant-key", captured_headers["x-api-key"]
    assert_equal "2023-06-01", captured_headers["anthropic-version"]

    parsed_body = JSON.parse(body_str)
    assert_equal "SYS_RULE", parsed_body["system"]
    assert_equal 1, parsed_body["messages"].length
    assert_equal "user", parsed_body["messages"][0]["role"]
    assert_equal "hello", parsed_body["messages"][0]["content"]

    # Assertions on returned response
    assert_equal "CLAUDE_REPLY", out[:content]
  end

  def test_anthropic_stream_yields_tokens
    require "aura/llm/adapters/anthropic"
    adapter = Aura::LLM::Adapters::Anthropic.new(api_base: nil, api_key: "ant-key", model: nil)
    
    @orig_start = Net::HTTP.method(:start)
    resp = Object.new
    resp.singleton_class.class_eval do
      define_method(:read_body) do |&bb|
        bb.call("data: {\"type\": \"content_block_delta\", \"delta\": {\"type\": \"text_delta\", \"text\": \"X\"}}\n")
        bb.call("data: {\"type\": \"content_block_delta\", \"delta\": {\"type\": \"text_delta\", \"text\": \"Y\"}}\n")
      end
    end

    http = Object.new
    http.singleton_class.class_eval do
      define_method(:request) do |req, &blk|
        blk.call(resp)
      end
    end

    Net::HTTP.singleton_class.class_eval do
      define_method(:start) do |host, port, opts, &blk|
        blk.call(http)
      end
    end

    tokens = []
    messages = [{ role: "user", content: "hello" }]
    out = adapter.complete_stream(messages, {}) { |tok| tokens << tok }
    assert_equal ["X", "Y"], tokens
    assert_equal "XY", out[:content]
  end
end
