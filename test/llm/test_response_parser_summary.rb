require "minitest/autorun"
require "json"

class TestResponseParserSummary < Minitest::Test
  def test_parse_includes_summary
    require "aura/llm/parsers/response_parser"
    body = { tool: "alpha", args: {}, summary: "简述：调用alpha" }.to_json
    res = Aura::LLM::Parsers::ResponseParser.parse(body)
    assert_equal "tool_call", res[:type]
    assert_equal "alpha", res[:tool]
    assert_equal "简述：调用alpha", res[:summary]
  end
end
