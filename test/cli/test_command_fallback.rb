require "minitest/autorun"
require "stringio"
require "aura/command"

class TestCommandFallback < Minitest::Test
  def test_unknown_command_message
    out = StringIO.new
    begin
      $stdout = out
      Aura::Command.invoke(:nonexistent, [])
    ensure
      $stdout = STDOUT
    end
    assert_includes out.string, "Unknown command"
  end
end

