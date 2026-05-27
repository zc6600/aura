# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "tmpdir"
require "yaml"
require "aura"
require "aura/cli/commands/application_command"

class TestCliConfigCommand < Minitest::Test
  def setup
    @tmp_dir = Dir.mktmpdir("aura-config-test-sandbox")
    
    @test_global_repo = File.join(@tmp_dir, "global_repo")
    @test_workspace = File.join(@tmp_dir, "my_project")
    @global_path = File.join(@tmp_dir, "global_repo_stub")
    
    # Stub Aura's global repo path to prevent reading/modifying developer config
    global_path_var = @global_path
    @orig_global_repo_path = Aura.method(:global_repo_path)
    Aura.define_singleton_method(:global_repo_path) do
      global_path_var
    end
    
    # Initialize mock global config
    FileUtils.mkdir_p(File.join(@global_path, "config"))
    File.write(File.join(@global_path, "config", "config.yml"), YAML.dump({
      "llm" => { "provider" => "local", "model" => "gpt-4" }
    }))
  end

  def teardown
    orig_repo = @orig_global_repo_path
    Aura.define_singleton_method(:global_repo_path) { orig_repo.call }
    FileUtils.remove_entry(@tmp_dir) if File.exist?(@tmp_dir)
  end

  def test_local_config_outside_workspace
    Dir.chdir(@tmp_dir) do
      cli = Aura::Commands::ApplicationCommand.new
      
      out, err = capture_io do
        assert_raises(SystemExit) do
          cli.config("some.key", "some_value")
        end
      end
      
      assert_match(/⛔️ Error: Not in an Aura workspace/, out)
    end
  end

  def test_config_type_parsing
    cli = Aura::Commands::ApplicationCommand.new
    FileUtils.mkdir_p(File.join(@test_workspace, ".aura", "config"))
    File.write(File.join(@test_workspace, ".aura", "config", "config.yml"), YAML.dump({}))
    
    Dir.chdir(@test_workspace) do
      # Set boolean true
      capture_io { cli.config("security.strict_path_isolation", "true") }
      # Set boolean false
      capture_io { cli.config("security.sandbox.enabled", "false") }
      # Set integer
      capture_io { cli.config("state_management.max_state_chars", "5000") }
      # Set float
      capture_io { cli.config("llm.temperature", "0.85") }
      # Set string
      capture_io { cli.config("llm.provider", "openai") }
      
      # Read them back via command line output
      out_true, _ = capture_io { cli.config("security.strict_path_isolation") }
      assert_equal "true\n", out_true
      
      out_false, _ = capture_io { cli.config("security.sandbox.enabled") }
      assert_equal "false\n", out_false
      
      out_int, _ = capture_io { cli.config("state_management.max_state_chars") }
      assert_equal "5000\n", out_int
      
      out_float, _ = capture_io { cli.config("llm.temperature") }
      assert_equal "0.85\n", out_float
      
      out_str, _ = capture_io { cli.config("llm.provider") }
      assert_equal "openai\n", out_str
      
      # Verify correct type parsing in YAML storage
      local_cfg = YAML.load_file(File.join(@test_workspace, ".aura", "config", "config.yml"))
      assert_equal true, local_cfg["security"]["strict_path_isolation"]
      assert_equal false, local_cfg["security"]["sandbox"]["enabled"]
      assert_equal 5000, local_cfg["state_management"]["max_state_chars"]
      assert_equal 0.85, local_cfg["llm"]["temperature"]
      assert_equal "openai", local_cfg["llm"]["provider"]
    end
  end

  def test_config_non_existent_key
    cli = Aura::Commands::ApplicationCommand.new
    FileUtils.mkdir_p(File.join(@test_workspace, ".aura", "config"))
    File.write(File.join(@test_workspace, ".aura", "config", "config.yml"), YAML.dump({}))
    
    Dir.chdir(@test_workspace) do
      out, _ = capture_io { cli.config("non.existent.key") }
      assert_match(/\(nil\)/, out)
    end
  end

  def test_config_list_all
    cli = Aura::Commands::ApplicationCommand.new
    FileUtils.mkdir_p(File.join(@test_workspace, ".aura", "config"))
    base_hash = { "llm" => { "provider" => "openai" }, "security" => { "strict" => true } }
    File.write(File.join(@test_workspace, ".aura", "config", "config.yml"), YAML.dump(base_hash))
    
    Dir.chdir(@test_workspace) do
      out, _ = capture_io { cli.config }
      parsed_yaml = YAML.safe_load(out)
      assert_equal "openai", parsed_yaml["llm"]["provider"]
      assert_equal true, parsed_yaml["security"]["strict"]
    end
  end

  def test_global_config_write_and_read
    cli = Aura::Commands::ApplicationCommand.new
    
    # Use global option
    cli.options = { "global" => true }
    
    # Write to global config outside a workspace
    Dir.chdir(@tmp_dir) do
      capture_io { cli.config("llm.provider", "anthropic") }
      
      out, _ = capture_io { cli.config("llm.provider") }
      assert_equal "anthropic\n", out
      
      # Verify global file
      global_cfg = YAML.load_file(File.join(@global_path, "config", "config.yml"))
      assert_equal "anthropic", global_cfg["llm"]["provider"]
    end
  end

  def test_global_flag_parsed_by_cli_start
    Dir.chdir(@tmp_dir) do
      capture_io do
        Aura::Commands::ApplicationCommand.start(["config", "llm.provider", "anthropic", "--global"])
      end

      out, _ = capture_io do
        Aura::Commands::ApplicationCommand.start(["config", "llm.provider", "--global"])
      end
      assert_equal "anthropic\n", out

      global_cfg = YAML.load_file(File.join(@global_path, "config", "config.yml"))
      assert_equal "anthropic", global_cfg["llm"]["provider"]
    end
  end
end
