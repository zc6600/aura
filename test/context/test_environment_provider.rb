require "minitest/autorun"
require "fileutils"
require "aura/context"

class TestEnvironmentProvider < Minitest::Test
  def setup
    @project = File.join(Dir.pwd, "tmp_env_project")
    FileUtils.rm_rf(@project)
    FileUtils.mkdir_p(@project)
    File.write(File.join(@project, "AURA_README.md"), "Follow workspace rules.")
    FileUtils.mkdir_p(File.join(@project, "knowledge"))
    File.write(File.join(@project, "knowledge", "API_Spec.pdf"), "PDF")
    File.write(File.join(@project, "knowledge", "API_Spec.pdf.hint"), "Use v2 endpoints")
    # config to avoid overflow
    FileUtils.mkdir_p(File.join(@project, "config"))
    File.write(File.join(@project, "config", "config.yml"), "state_management:\n  max_state_chars: 10000\n")
  end

  def teardown
    FileUtils.rm_rf(@project)
  end

  def test_environment_includes_rules_hints_and_global_tags
    # Add a global aura hint in a markdown file
    File.write(File.join(@project, "note.md"), "# @aura-hint: Remember to optimize")
    out = Aura::Context.assemble(@project, nil)
    assert_includes out, "# SYSTEM & ENVIRONMENT"
    assert_includes out, "## Global Rules"
    assert_includes out, "## Active Tags & Guidance"
    assert_includes out, "[From note.md]: Remember to optimize"
    assert_includes out, "## Knowledge Assets"
    assert_includes out, "API_Spec.pdf (Context: Use v2 endpoints)"
  end
end
