require "minitest/autorun"
require "fileutils"
require "stringio"
require "json"
require "yaml"
require "aura"
require "aura/cli/commands/skills_command"
require "aura/cli/commands/tools_command"
require "aura/context/environment_provider"

class TestSkillsToolsInstall < Minitest::Test
  def setup
    @project = File.join(Dir.pwd, "tmp_test_install_project")
    @mock_home = File.join(Dir.pwd, "tmp_mock_home")
    FileUtils.rm_rf(@project)
    FileUtils.rm_rf(@mock_home)
    FileUtils.mkdir_p(@project)
    FileUtils.mkdir_p(@mock_home)

    @orig_resolve = Aura.method(:resolve_project_path!)
    @orig_dir_home = Dir.method(:home)

    proj = @project
    Aura.define_singleton_method(:resolve_project_path!) do |*args|
      proj
    end
  end

  def teardown
    # Restore mock methods
    orig_resolve = @orig_resolve
    Aura.define_singleton_method(:resolve_project_path!) do |*args|
      orig_resolve.call(*args)
    end

    orig_dir_home = @orig_dir_home
    Dir.define_singleton_method(:home) do
      orig_dir_home.call
    end

    FileUtils.rm_rf(@project)
    FileUtils.rm_rf(@mock_home)
  end

  def test_skill_install_local_path
    # Prepare a source skill directory
    src_skill = File.join(@project, "my_source_skill")
    FileUtils.mkdir_p(src_skill)
    File.write(File.join(src_skill, "SKILL.md"), <<~MD)
      ---
      name: custom_skill
      description: This is a custom skill
      ---
      # Custom Skill Content
    MD

    # Redirect stdout to suppress print logs
    original_stdout = $stdout
    $stdout = StringIO.new
    begin
      cmd = Aura::Commands::SkillsCommand.new
      cmd.install(src_skill)
    ensure
      $stdout = original_stdout
    end

    # Check if the skill has been copied to the destination
    dest_skill = File.join(@project, "skills", "custom_skill")
    assert File.directory?(dest_skill)
    assert File.exist?(File.join(dest_skill, "SKILL.md"))
    assert_includes File.read(File.join(dest_skill, "SKILL.md")), "This is a custom skill"
  end

  def test_tool_install_local_path_and_add_redirect
    # Prepare a source tool directory
    src_tool = File.join(@project, "my_source_tool")
    FileUtils.mkdir_p(src_tool)
    File.write(File.join(src_tool, "manifest.json"), {
      name: "custom_tool",
      description: "My custom tool description",
      runtime: "python"
    }.to_json)
    File.write(File.join(src_tool, "logic.py"), "# Logic")

    # Run the tools add command (which should redirect to install)
    Dir.chdir(@project) do
      original_stdout = $stdout
      $stdout = StringIO.new
      begin
        cmd = Aura::Commands::ToolsCommand.new
        cmd.add(src_tool)
      ensure
        $stdout = original_stdout
      end
    end

    # Check if the tool has been copied to the destination
    dest_tool = File.join(@project, "tools", "custom_tool")
    assert File.directory?(dest_tool)
    assert File.exist?(File.join(dest_tool, "manifest.json"))
    assert File.exist?(File.join(dest_tool, "logic.py"))
  end

  def test_global_hint_injection
    # Prepare global hint file inside mock home ~/.aura/global_hint.md
    aura_config_dir = File.join(@mock_home, ".aura")
    FileUtils.mkdir_p(aura_config_dir)
    File.write(File.join(aura_config_dir, "global_hint.md"), "GLOBAL_RULE_PREFERENCE_INJECTED")

    # Mock Dir.home
    mhome = @mock_home
    Dir.define_singleton_method(:home) do
      mhome
    end

    provider = Aura::Context::EnvironmentProvider.new(@project)
    output = provider.provide

    assert_includes output, "GLOBAL_RULE_PREFERENCE_INJECTED"
    assert_includes output, "### Global User Preferences & Operational Rules:"
  end
end
