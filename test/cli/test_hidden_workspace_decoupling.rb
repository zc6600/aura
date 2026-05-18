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

  def test_register_and_prune_commands
    cli = Aura::Commands::ApplicationCommand.new
    FileUtils.mkdir_p(@test_workspace)
    
    # 1. Initialize local folder without registering (manually copy/mock it)
    hidden = File.join(@test_workspace, ".aura")
    FileUtils.mkdir_p(File.join(hidden, "config"))
    File.write(File.join(hidden, "config", "config.yml"), YAML.dump({}))
    
    # 2. Run register inside CWD
    Dir.chdir(@test_workspace) do
      cli.register("manually_imported_project")
    end
    
    # Verify registered
    registered = Aura.registered_projects
    assert_equal File.realdirpath(@test_workspace), File.realdirpath(registered["manually_imported_project"])
    
    # Verify local config contains name
    local_cfg = YAML.load_file(File.join(hidden, "config", "config.yml"))
    assert_equal "manually_imported_project", local_cfg["project_name"]

    # 3. Test pruning: delete local .aura folder and run prune
    FileUtils.rm_rf(hidden)
    out, err = capture_io do
      cli.prune
    end
    assert_match(/Pruned missing project 'manually_imported_project'/, out)
    assert_match(/Successfully pruned 1 missing project/, out)
    
    # Verify unregistered
    registered = Aura.registered_projects
    assert_nil registered["manually_imported_project"]
  end

  def test_agent_branching_and_profiles
    cli = Aura::Commands::ApplicationCommand.new
    FileUtils.mkdir_p(@test_workspace)
    Dir.chdir(@test_workspace) do
      cli.new("test_project")
    end

    Dir.chdir(@test_workspace) do
      # 1. List branches (should have only main active)
      out, err = capture_io do
        cli.branch
      end
      assert_match(/main/, out)

      # 2. Switch to a new profile (does not exist, prompt for creation)
      $stdin = StringIO.new("y")
      out, err = capture_io do
        cli.branch("data-scientist")
      end
      $stdin = STDIN

      assert_match(/Successfully created and switched to new agent profile 'data-scientist'/, out)

      # 3. List branches again (should show active data-scientist)
      out, err = capture_io do
        cli.branch
      end
      assert_match(/\* data-scientist/, out)

      # 4. Switch back to main (already exists)
      out, err = capture_io do
        cli.branch("main")
      end
      assert_match(/Successfully switched active agent profile to 'main'/, out)
    end
  end

  def test_conversation_sessions_isolation
    FileUtils.mkdir_p(@test_workspace)
    hidden = File.join(@test_workspace, ".aura")
    state_dir = File.join(hidden, "state")
    FileUtils.mkdir_p(state_dir)

    # 1. Test Legacy Migration
    legacy_db = File.join(state_dir, "aura.db")
    SQLite3::Database.new(legacy_db).close
    
    state = Aura::Kernel::State.new(hidden)
    default_db = File.join(state_dir, "sessions", "default.db")
    assert File.exist?(default_db), "Legacy aura.db should be migrated to sessions/default.db"
    refute File.exist?(legacy_db), "Legacy aura.db should be cleanly moved/removed"

    # 2. Test Session Separation in State
    state = Aura::Kernel::State.new(hidden)
    state.record_event({ phase: "user", content: "hello world" })
    
    db_default = state.instance_variable_get(:@db)
    assert_equal 1, db_default.get_first_value("SELECT COUNT(*) FROM events")
    
    # Start a brand new session by changing ENV
    begin
      ENV["AURA_SESSION_NAME"] = "data_scientist_run"
      state_ds = Aura::Kernel::State.new(hidden)
      
      db_ds = state_ds.instance_variable_get(:@db)
      assert_equal 0, db_ds.get_first_value("SELECT COUNT(*) FROM events")
      state_ds.record_event({ phase: "user", content: "run python script" })
      assert_equal 1, db_ds.get_first_value("SELECT COUNT(*) FROM events")
      
      # Verify default db still only has its original turns (no memory leaking!)
      ENV["AURA_SESSION_NAME"] = "default"
      state_default = Aura::Kernel::State.new(hidden)
      db_default2 = state_default.instance_variable_get(:@db)
      assert_equal 1, db_default2.get_first_value("SELECT COUNT(*) FROM events")
    ensure
      ENV["AURA_SESSION_NAME"] = nil
    end

    # 3. Test SlashCommandManager /session command and Hot-Reload callback
    config_loader = -> { {} }
    runner_mock = Object.new
    def runner_mock.undo; true; end
    
    reload_called = false
    on_reload = -> { reload_called = true }
    
    slash = Aura::CLI::Shell::SlashCommandManager.new(@test_workspace, config_loader, runner_mock, on_reload: on_reload)
    
    # List sessions
    out, err = capture_io do
      slash.handle("/session list")
    end
    assert_match(/Aura Conversation Sessions:/, out)
    assert_match(/default/, out)
    assert_match(/data_scientist_run/, out)
    
    # Switch session
    out, err = capture_io do
      slash.handle("/session scientist")
    end
    assert_match(/Switching conversation session to 'scientist'/, out)
    assert_match(/Successfully switched and hot-loaded session 'scientist'/, out)
    assert reload_called, "on_reload callback should have been triggered on session switch"
    assert_equal "scientist", ENV["AURA_SESSION_NAME"]
    
    # Verify active_session.txt is updated
    active_txt = File.join(state_dir, "active_session.txt")
    assert File.exist?(active_txt)
    assert_equal "scientist", File.read(active_txt).strip
  ensure
    ENV["AURA_SESSION_NAME"] = nil
  end

  def test_date_based_fallback_name
    cli = Aura::Commands::ApplicationCommand.new
    FileUtils.mkdir_p(@test_workspace)
    Dir.chdir(@test_workspace) do
      cli.new
    end
    hidden = File.join(@test_workspace, ".aura")
    assert File.directory?(hidden)
    local_cfg = YAML.load_file(File.join(hidden, "config", "config.yml"))
    assert_match(/^aura_\d{4}_\d{2}_\d{2}_\d{6}$/, local_cfg["project_name"])
  end

  def test_climb_parent_directories_workspace_resolution
    # Initialize workspace
    cli = Aura::Commands::ApplicationCommand.new
    FileUtils.mkdir_p(@test_workspace)
    Dir.chdir(@test_workspace) do
      cli.new("climbing_project")
    end

    # Create a deep subdirectory inside workspace
    deep_dir = File.join(@test_workspace, "src", "components", "buttons")
    FileUtils.mkdir_p(deep_dir)

    # Instantiate KernelCommand
    k_cli = Aura::Commands::KernelCommand.new
    
    # Test resolve_project_path! starts searching from subfolder and climbs up successfully
    resolved = k_cli.send(:resolve_project_path!, deep_dir)
    assert_equal File.realdirpath(@test_workspace), File.realdirpath(resolved)

    # Test resolve_project_path! defaults to Dir.pwd when arg is nil, climbing up successfully
    Dir.chdir(deep_dir) do
      resolved = k_cli.send(:resolve_project_path!, nil)
      assert_equal File.realdirpath(@test_workspace), File.realdirpath(resolved)
    end

    # Test resolve_project_path! aborts/exits when outside a workspace
    non_workspace = @tmp_dir
    assert_raises(SystemExit) do
      capture_io do
        k_cli.send(:resolve_project_path!, non_workspace)
      end
    end
  end

  def test_chat_command_resolves_workspace_automatically
    cli = Aura::Commands::ApplicationCommand.new
    FileUtils.mkdir_p(@test_workspace)
    Dir.chdir(@test_workspace) do
      cli.new("chat_climbing_project")
    end

    deep_dir = File.join(@test_workspace, "src", "components")
    FileUtils.mkdir_p(deep_dir)

    class << Aura::Commands::ShellCommand
      alias_method :original_new, :new
      define_method(:new) do
        mock_shell = Object.new
        mock_shell.define_singleton_method(:start) do |project_path|
          Aura::Commands::ShellCommand.instance_variable_set(:@called_path, project_path)
        end
        mock_shell
      end
    end

    begin
      Dir.chdir(deep_dir) do
        cli.chat
      end
    ensure
      called_path = Aura::Commands::ShellCommand.instance_variable_get(:@called_path)
      class << Aura::Commands::ShellCommand
        alias_method :new, :original_new
        remove_method :original_new
      end
    end
    
    assert_equal File.realdirpath(@test_workspace), File.realdirpath(called_path)
  end
end
