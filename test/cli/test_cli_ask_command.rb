# frozen_string_literal: true

require "minitest/autorun"
require "aura"
require "aura/cli/commands/application_command"
require "aura/llm/client"

class MockLLMClient
  attr_reader :provider, :model

  def initialize(provider:, api_base: nil, api_key: nil, model: nil)
    @provider = provider
    @model = model
  end

  def complete_stream(messages, options, &block)
    # Yield mock response delta back
    block.call("Life is beautiful.")
  end
end

class TestCliAskCommand < Minitest::Test
  def test_ask_command_direct_query
    cli = Aura::Commands::ApplicationCommand.new
    
    # Metaprogramming stub
    class << Aura::LLM::Client
      alias_method :original_new, :new
      def new(provider:, api_base: nil, api_key: nil, model: nil)
        MockLLMClient.new(provider: provider, api_base: api_base, api_key: api_key, model: model)
      end
    end
    
    begin
      cli.options = { "provider" => "local", "model" => "mock-model", "system" => "Custom system instructions" }
      out, err = capture_io do
        cli.ask("What is the meaning of life?")
      end
      
      assert_match(/Connecting to local \(mock-model\)/, out)
      assert_match(/Life is beautiful\./, out)
    ensure
      # Restore original method
      class << Aura::LLM::Client
        alias_method :new, :original_new
        remove_method :original_new
      end
    end
  end
end
