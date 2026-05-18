# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "tmpdir"
require "yaml"
require "aura"
require "aura/cli/commands/application_command"

class TestHiddenWorkspaceDecoupling < Minitest::Test
  def setup
    @tmp_dir = Dir.mktmpdir("aura-test-sandbox")
    
    # Decouple test environment from actual developer configurations
    @test_global_repo = File.join(@tmp_dir, "global_repo")
    @test_workspace = File.join(@tmp_dir, "my_project")
    
    # Stub Aura's global repo path and projects list to point to our test folder
    Aura.define_singleton_method(:global_repo_path) do
      File.join(Dir.tmpdir, "aura-test-sandbox-global-repo")
    end
    Aura.define_singleton_method(:global_projects_config_path) do
      File.join(Dir.tmpdir, "aura-test-sandbox-projects.yml")
    end
    @global_path = Aura.global_repo_path
    
    # Initialize a mock template repo
    FileUtils.mkdir_p(File.join(@global_path, "config"))
    FileUtils.mkdir_p(File.join(@global_path, "tools", "mock_tool"))
    
    # Write a base config in global template repo
    File.write(File.join(@global_path, "config", "config.yml"), YAML.dump({
      "llm" => { "provider" => "local", "model" => "gpt-4" },
      "security" => { "strict_path_isolation" => true }
    }))
    
    # Initialize global template repo as a git repo
    system("git -C #{@global_path} init -q")
    system("git -C #{@global_path} config user.name 'Test Aura'")
    system("git -C #{@global_path} config user.email 'test@aura-os.ai'")
    system("git -C #{@global_path} config receive.denyCurrentBranch updateInstead")
    system("git -C #{@global_path} checkout -b main -q")
    system("git -C #{@global_path} add .")
    system("git -C #{@global_path} commit -m 'Initial global template' -q")
    system("git -C #{@global_path} branch -M main -q")
  end

  def teardown
    FileUtils.remove_entry(@tmp_dir) if File.exist?(@tmp_dir)
    FileUtils.remove_entry(@global_path) if File.exist?(@global_path)
    proj_path = Aura.global_projects_config_path
    FileUtils.remove_entry(proj_path) if File.exist?(proj_path)
  end

  def test_path_decoupling_helpers
    # 1. Without hidden folder
    assert_equal @test_workspace, Aura.environment_path(@test_workspace)
    assert_equal @test_workspace, Aura.workspace_path(@test_workspace)
    
    # 2. With hidden folder
    hidden_dir = File.join(@test_workspace, ".aura")
    FileUtils.mkdir_p(hidden_dir)
    
    assert_equal hidden_dir, Aura.environment_path(@test_workspace)
    assert_equal @test_workspace, Aura.workspace_path(hidden_dir)
    assert_equal @test_workspace, Aura.workspace_path(@test_workspace)
  end

  def test_workspace_initialization_with_hidden_aura
    cli = Aura::Commands::ApplicationCommand.new
    
    # Run aura new inside workspace CWD
    FileUtils.mkdir_p(@test_workspace)
    Dir.chdir(@test_workspace) do
      cli.new("my_test_project")
    end
    
    hidden = File.join(@test_workspace, ".aura")
    assert File.directory?(hidden), "Hidden .aura folder should exist"
    assert File.exist?(File.join(hidden, "config", "config.yml")), "Config should exist inside .aura"
    
    # Verify .gitignore in parent workspace
    gitignore = File.read(File.join(@test_workspace, ".gitignore"))
    assert gitignore.include?(".aura/"), ".gitignore should ignore hidden folder"
    
    # Verify inner .gitignore
    inner_ignore = File.read(File.join(hidden, ".gitignore"))
    assert inner_ignore.include?("state/aura.db*"), "Inner gitignore should ignore sqlite transient state"

    # Verify global projects list registry
    registered = Aura.registered_projects
    assert_equal File.realdirpath(@test_workspace), File.realdirpath(registered["my_test_project"])

    # Verify project name written to config
    local_cfg = YAML.load_file(File.join(hidden, "config", "config.yml"))
    assert_equal "my_test_project", local_cfg["project_name"]
  end

  def test_configuration_management_local_and_global
    cli = Aura::Commands::ApplicationCommand.new
    FileUtils.mkdir_p(@test_workspace)
    Dir.chdir(@test_workspace) do
      cli.new("test_project")
    end
    
    # Switch working directory to test workspace
    Dir.chdir(@test_workspace) do
      # 1. Local Write & Read (nested keys)
      out, err = capture_io do
        cli.config("llm.model", "claude-3")
      end
      assert_match(/Successfully updated llm.model to claude-3/, out)
      
      out, err = capture_io do
        cli.config("llm.model")
      end
      assert_equal "claude-3\n", out
      
      # Verify local yaml content
      local_cfg = YAML.load_file(File.join(@test_workspace, ".aura", "config", "config.yml"))
      assert_equal "claude-3", local_cfg["llm"]["model"]
      
      # 2. Global configuration check
      # Local change shouldn't affect global template repo
      global_cfg = YAML.load_file(File.join(@global_path, "config", "config.yml"))
      assert_equal "gpt-4", global_cfg["llm"]["model"]
      
      # Write global config via CLI
      options = { "global" => true }
      cli.options = options
      out, err = capture_io do
        cli.config("llm.provider", "anthropic")
      end
      assert_match(/Successfully updated llm.provider to anthropic/, out)
      
      # Read back global
      out, err = capture_io do
        cli.config("llm.provider")
      end
      assert_equal "anthropic\n", out
    end
  end

  def test_git_vcs_syncing_flow
    cli = Aura::Commands::ApplicationCommand.new
    FileUtils.mkdir_p(@test_workspace)
    Dir.chdir(@test_workspace) do
      cli.new("test_project")
    end
    
    Dir.chdir(@test_workspace) do
      # Create a new local tool inside .aura/tools/
      new_tool_dir = File.join(@test_workspace, ".aura", "tools", "custom_tool")
      FileUtils.mkdir_p(new_tool_dir)
      File.write(File.join(new_tool_dir, "manifest.json"), '{"name": "custom_tool"}')
      File.write(File.join(new_tool_dir, "logic.py"), 'print("hello")')
      
      # Add changes
      out, err = capture_io do
        cli.add("tools/custom_tool")
      end
      assert_match(/Successfully staged changes inside .aura/, out)
      
      # Commit changes
      cli.options = { "message" => "Add new tool" }
      out, err = capture_io do
        cli.commit
      end
      assert_match(/Successfully committed changes/, out)
      
      # Sync (push) changes back to global repo
      out, err = capture_io do
        cli.sync
      end
      assert_match(/Successfully synced local changes to global repo/, out)
      
      # Verify global repository now contains the staged tool!
      assert File.exist?(File.join(@global_path, "tools", "custom_tool", "manifest.json")), "Global repo should now have the synced tool!"
    end
  end

  def test_list_and_delete_commands
    cli = Aura::Commands::ApplicationCommand.new
    FileUtils.mkdir_p(@test_workspace)
    Dir.chdir(@test_workspace) do
      cli.new("test_project")
    end

    # Test list output
    out, err = capture_io do
      cli.list
    end
    assert_match(/test_project/, out)
    assert_match(/Active/, out)

    # Test delete command unregistration
    # Stub stdin to return 'y'
    $stdin = StringIO.new("y")
    out, err = capture_io do
      cli.delete("test_project")
    end
    $stdin = STDIN # restore
    
    assert_match(/Successfully deleted physical sandbox/, out)
    assert_match(/successfully unregistered globally/, out)
    
    # Verify unregistered in global registry
    registered = Aura.registered_projects
    assert_nil registered["test_project"]
    refute File.exist?(File.join(@test_workspace, ".aura"))
  end
end
