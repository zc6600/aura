require "minitest/autorun"

class TestOpenRouterAdapter < Minitest::Test
  def setup
    @prev_key = ENV["OPENROUTER_API_KEY"]
    ENV["OPENROUTER_API_KEY"] = "sk-test"
  end

  def teardown
    ENV["OPENROUTER_API_KEY"] = @prev_key
    # restore Net::HTTP.start if needed
    if @orig_start
      Net::HTTP.singleton_class.define_method(:start, @orig_start)
    end
  end

  def test_complete_extracts_content
    require "aura/llm/adapters/openrouter"
    @orig_start = Net::HTTP.method(:start)
    fake_http = Class.new do
      def request(_req)
        Struct.new(:body).new('{"choices":[{"message":{"content":"PLAN"}}]}')
      end
    end
    Net::HTTP.singleton_class.class_eval do
      define_method(:start) do |host, port, opts, &blk|
        blk.call(fake_http.new)
      end
    end
    adapter = Aura::LLM::Adapters::OpenRouter.new(api_base: nil, api_key: ENV["OPENROUTER_API_KEY"], model: "x")
    out = adapter.complete([{ role: "user", content: "hi" }], {})
    assert_equal "PLAN", out[:content]
    assert out[:raw]
  end

  def test_complete_stream_yields_tokens
    require "aura/llm/adapters/openrouter"
    @orig_start = Net::HTTP.method(:start)
    resp = Object.new
    resp.singleton_class.class_eval do
      define_method(:read_body) do |&bb|
        bb.call("data: {\"choices\":[{\"delta\":{\"content\":\"A\"}}]}\n")
        bb.call("data: {\"choices\":[{\"delta\":{\"content\":\"B\"}}]}\n")
        bb.call("data: [DONE]\n")
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
    adapter = Aura::LLM::Adapters::OpenRouter.new(api_base: nil, api_key: ENV["OPENROUTER_API_KEY"], model: "x")
    toks = []
    out = adapter.complete_stream([{ role: "user", content: "hi" }], {}) { |d| toks << d }
    assert_equal ["A", "B"], toks
    assert_equal "AB", out[:content]
  end
end
