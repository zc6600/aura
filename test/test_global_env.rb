# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "tmpdir"
require "aura"

class TestGlobalEnv < Minitest::Test
  def setup
    @orig_global_env = ENV["AURA_GLOBAL_ENV"]
    ENV["AURA_GLOBAL_ENV"] = "true"
    @temp_home = Dir.mktmpdir("aura-home-test")
    @orig_home = ENV["HOME"]
    ENV["HOME"] = @temp_home
  end

  def teardown
    ENV["AURA_GLOBAL_ENV"] = @orig_global_env
    ENV["HOME"] = @orig_home
    FileUtils.rm_rf(@temp_home) if @temp_home && File.directory?(@temp_home)
  end

  def test_global_env_paths
    workspace = "/some/random/dir"
    
    # Stub WorkspaceInitializer.initialize_global_env so it doesn't actually clone git
    # and create physical directories in /some/random/dir or our fake HOME
    called_init = false
    Aura::WorkspaceInitializer.define_singleton_method(:initialize_global_env) do
      called_init = true
      File.expand_path("~/.aura/global")
    end

    begin
      env_path = Aura::PathResolver.environment_path(workspace)
      assert_equal File.expand_path("~/.aura/global"), env_path
      assert called_init, "WorkspaceInitializer.initialize_global_env was not called"

      resolved_workspace = Aura::PathResolver.workspace_path(workspace)
      assert_equal File.expand_path(workspace), resolved_workspace

      resolved_project = Aura::PathResolver.resolve_project_path(workspace)
      assert_equal File.expand_path(workspace), resolved_project
    ensure
      # Restore original method if needed
      # (Though in our test run it's redefined anyway, let's keep it clean)
    end
  end
end
