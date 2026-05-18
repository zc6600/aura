require "minitest/autorun"
require "aura/cli/entry"

class TestCliRouting < Minitest::Test
  def test_help_routes_to_application
    require "aura/cli/commands/application_command"
    $called = false
    klass = Aura::Commands::ApplicationCommand
    def klass.start(*); $called = true; end

    Aura::CLI.start(["help"]) # should dispatch to ApplicationCommand.start
    assert $called, "CLI did not dispatch to ApplicationCommand"
  end
end

