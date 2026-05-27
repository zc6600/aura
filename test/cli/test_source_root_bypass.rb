# frozen_string_literal: true

require "minitest/autorun"
require "aura/cli/entry"
require "aura/cli/command"

class TestSourceRootBypass < Minitest::Test
  def setup
    @orig_allow_root = ENV["AURA_ALLOW_ROOT"]
    ENV["AURA_ALLOW_ROOT"] = nil
  end

  def teardown
    ENV["AURA_ALLOW_ROOT"] = @orig_allow_root
  end

  def test_should_block_root_by_default_outside_tests
    # Normally, it should block 'chat' outside test environments when in the source root
    assert Aura::CLI::EntryPoint.should_block_root?(["chat"], "chat", is_test: false)
  end

  def test_should_not_block_root_if_test_environment
    # The check is bypassed in testing environments
    refute Aura::CLI::EntryPoint.should_block_root?(["chat"], "chat", is_test: true)
  end

  def test_should_not_block_root_if_whitelisted_command
    # Whitelisted commands (like 'info', 'doctor') should not block
    refute Aura::CLI::EntryPoint.should_block_root?(["info"], "info", is_test: false)
    refute Aura::CLI::EntryPoint.should_block_root?(["doctor"], "doctor", is_test: false)
  end

  def test_should_not_block_root_if_allow_root_env_var_set
    ENV["AURA_ALLOW_ROOT"] = "true"
    refute Aura::CLI::EntryPoint.should_block_root?(["chat"], "chat", is_test: false)
  end

  def test_should_not_block_root_with_help_flags
    # Help flags should bypass the block
    refute Aura::CLI::EntryPoint.should_block_root?(["chat", "--help"], "chat", is_test: false)
    refute Aura::CLI::EntryPoint.should_block_root?(["chat", "-h"], "chat", is_test: false)
  end

  def test_allow_root_flag_stripping_and_handling
    # The --allow-root flag should be stripped from argv when calling EntryPoint.start
    argv = ["chat", "--allow-root"]
    called = false
    called_cmd = nil
    called_args = nil
    
    original_invoke = Aura::Command.method(:invoke)
    Aura::Command.define_singleton_method(:invoke) do |cmd, args, **config|
      called = true
      called_cmd = cmd
      called_args = args.dup
    end

    begin
      Aura::CLI::EntryPoint.start(argv)
    ensure
      Aura::Command.define_singleton_method(:invoke, &original_invoke)
    end

    assert called, "Aura::Command.invoke was not called"
    assert_equal :application, called_cmd
    assert_equal ["chat"], called_args
    assert_equal ["chat"], argv # should have stripped --allow-root
  end

  def test_allow_root_flag_at_start_stripping_and_handling
    argv = ["--allow-root", "chat"]
    called = false
    called_cmd = nil
    called_args = nil
    
    original_invoke = Aura::Command.method(:invoke)
    Aura::Command.define_singleton_method(:invoke) do |cmd, args, **config|
      called = true
      called_cmd = cmd
      called_args = args.dup
    end

    begin
      Aura::CLI::EntryPoint.start(argv)
    ensure
      Aura::Command.define_singleton_method(:invoke, &original_invoke)
    end

    assert called, "Aura::Command.invoke was not called"
    assert_equal :application, called_cmd
    assert_equal ["chat"], called_args
    assert_equal ["chat"], argv
  end
end
