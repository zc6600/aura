# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "json"
require "aura"
require "aura/cli/commands/application_command"
require "aura/llm/client"

class MockLLMClientForAsk
  attr_reader :provider, :model

  def initialize(provider:, api_base: nil, api_key: nil, model: nil)
    @provider = provider
    @model = model
  end

  def configs_chain
    [{ provider: @provider, api_key: nil, model: @model }]
  end

  def complete_stream(messages, options, &block)
    # Save messages for verification in tests
    Thread.current[:mock_llm_messages] = messages
    block.call("Life is beautiful.")
  end
end

class TestCliAskCommand < Minitest::Test
  def setup
    # Determine the test ask_sessions directory and make sure it's clean
    @test_state_dir = File.join(Aura.global_repo_path, "state")
    @sessions_dir = File.join(@test_state_dir, "ask_sessions")
    FileUtils.rm_rf(@sessions_dir)
    
    # Metaprogramming stub
    class << Aura::LLM::Client
      alias_method :original_new, :new
      def new(provider:, api_base: nil, api_key: nil, model: nil)
        MockLLMClientForAsk.new(provider: provider, api_base: api_base, api_key: api_key, model: model)
      end
    end

    class << Aura
      alias_method :original_find_aura_dir, :find_aura_dir
      def find_aura_dir(*args)
        nil
      end
    end
  end

  def teardown
    # Restore original method
    class << Aura::LLM::Client
      alias_method :new, :original_new
      remove_method :original_new
    end
    class << Aura
      alias_method :find_aura_dir, :original_find_aura_dir
      remove_method :original_find_aura_dir
    end
    FileUtils.rm_rf(@sessions_dir)
    Thread.current[:mock_llm_messages] = nil
  end

  def test_ask_command_direct_query
    cli = Aura::Commands::ApplicationCommand.new
    cli.options = { "provider" => "local", "model" => "mock-model", "system" => "Custom system instructions" }
    
    out, err = capture_io do
      cli.ask("What is the meaning of life?")
    end
    
    assert_match(/Connecting to local \(mock-model\)/, out)
    assert_match(/Life is beautiful\./, out)
  end

  def test_ask_command_retains_memory
    cli = Aura::Commands::ApplicationCommand.new
    cli.options = { "provider" => "local", "model" => "mock-model", "session" => "test_memory_session" }
    
    # First turn
    capture_io do
      cli.ask("Question 1")
    end
    
    assert_equal "Question 1", Thread.current[:mock_llm_messages].last[:content]
    
    # Check history file was created
    history_file = File.join(@sessions_dir, "test_memory_session.json")
    assert File.exist?(history_file), "History file should be created"
    
    history_data = JSON.parse(File.read(history_file))
    assert_equal 2, history_data.size
    assert_equal "Question 1", history_data[0]["content"]
    assert_equal "Life is beautiful.", history_data[1]["content"]

    # Second turn - should include previous turn in LLM messages
    capture_io do
      cli.ask("Question 2")
    end
    
    msgs = Thread.current[:mock_llm_messages]
    # Length of messages: [Question 1 (user), Life is beautiful (assistant), Question 2 (user)]
    assert_equal 3, msgs.size
    assert_equal "Question 1", msgs[0][:content]
    assert_equal "Life is beautiful.", msgs[1][:content]
    assert_equal "Question 2", msgs[2][:content]
  end

  def test_ask_command_clear_memory
    cli = Aura::Commands::ApplicationCommand.new
    
    # Create manual pre-existing history file
    FileUtils.mkdir_p(@sessions_dir)
    history_file = File.join(@sessions_dir, "test_clear_session.json")
    pre_existing_data = [{ role: "user", content: "Old question" }, { role: "assistant", content: "Old answer" }]
    File.write(history_file, JSON.dump(pre_existing_data))
    
    cli.options = { "provider" => "local", "model" => "mock-model", "session" => "test_clear_session", "clear" => true }
    
    out, err = capture_io do
      cli.ask("New question")
    end
    
    # Verify console output indicates memory cleared
    assert_match(/Memory cleared for session 'test_clear_session'/, out)
    
    # Verify that the LLM call ONLY contained the new question (no history)
    msgs = Thread.current[:mock_llm_messages]
    assert_equal 1, msgs.size
    assert_equal "New question", msgs[0][:content]
  end
end
