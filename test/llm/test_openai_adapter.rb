# frozen_string_literal: true

require "minitest/autorun"
require "aura/llm/client"
require "aura/llm/adapters/openai"

class TestOpenAIAdapter < Minitest::Test
  def teardown
    if @orig_start
      Net::HTTP.singleton_class.define_method(:start, @orig_start)
    end
  end

  def test_openai_adapter_default_endpoint_and_routing
    adapter = Aura::LLM::Adapters::OpenAI.new(api_base: nil, api_key: "oa-key", model: nil)
    assert_equal "https://api.openai.com/v1/chat/completions", adapter.instance_variable_get(:@api_base)
    assert_equal "gpt-4o-mini", adapter.instance_variable_get(:@model)

    client = Aura::LLM::Client.new(provider: "openai", api_key: "oa-key")
    underlying = client.send(:build_adapter)
    assert_kind_of Aura::LLM::Adapters::OpenAI, underlying
  end

  def test_openai_complete_request_and_response
    adapter = Aura::LLM::Adapters::OpenAI.new(api_base: nil, api_key: "oa-key", model: "gpt-4o")
    
    @orig_start = Net::HTTP.method(:start)
    captured_headers = {}
    captured_body = nil

    fake_http = Class.new do
      def initialize(headers, body_ref)
        @headers = headers
        @body_ref = body_ref
      end

      def request(req)
        @headers["Authorization"] = req["Authorization"]
        @headers["Content-Type"] = req["Content-Type"]
        @body_ref.replace(req.body)

        response_body = {
          "choices" => [
            {
              "message" => {
                "role" => "assistant",
                "content" => "OPENAI_REPLY"
              },
              "finish_reason" => "stop"
            }
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

    messages = [{ role: "user", content: "hello" }]
    out = adapter.complete(messages, { temperature: 0.5 })

    assert_equal "Bearer oa-key", captured_headers["Authorization"]
    assert_equal "application/json", captured_headers["Content-Type"]

    parsed_body = JSON.parse(body_str)
    assert_equal "gpt-4o", parsed_body["model"]
    assert_equal 0.5, parsed_body["temperature"]
    assert_equal "hello", parsed_body["messages"][0]["content"]

    assert_equal "OPENAI_REPLY", out[:content]
    assert_equal "stop", out[:finish_reason]
  end

  def test_openai_stream_yields_tokens_and_handles_tool_calls
    adapter = Aura::LLM::Adapters::OpenAI.new(api_base: nil, api_key: "oa-key", model: "gpt-4o")
    
    @orig_start = Net::HTTP.method(:start)
    
    resp = Object.new
    resp.singleton_class.class_eval do
      define_method(:read_body) do |&block|
        block.call("data: {\"choices\": [{\"delta\": {\"content\": \"Hello\"}, \"finish_reason\": null}]}\n")
        block.call("data: {\"choices\": [{\"delta\": {\"tool_calls\": [{\"index\": 0, \"id\": \"call_1\", \"function\": {\"name\": \"read_file\", \"arguments\": \"{\\\"path\\\"\"}}]}, \"finish_reason\": null}]}\n")
        block.call("data: {\"choices\": [{\"delta\": {\"tool_calls\": [{\"index\": 0, \"function\": {\"arguments\": \": \\\"a.txt\\\"}\"}}]}, \"finish_reason\": \"tool_calls\"}]}\n")
        block.call("data: [DONE]\n")
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

    assert_equal ["Hello"], tokens
    assert_equal "Hello", out[:content]
    assert_equal "tool_calls", out[:finish_reason]
    
    raw_choice = out[:raw]["choices"][0]
    assert_equal "assistant", raw_choice["message"]["role"]
    
    tool_call = raw_choice["message"]["tool_calls"][0]
    assert_equal "call_1", tool_call["id"]
    assert_equal "read_file", tool_call["function"]["name"]
    assert_equal "{\"path\": \"a.txt\"}", tool_call["function"]["arguments"]
  end
end
