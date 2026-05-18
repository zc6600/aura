require "minitest/autorun"
require "fileutils"
require "aura/context"

class TestDirectiveProvider < Minitest::Test
  def setup
    @project = File.join(Dir.pwd, "tmp_directive_project")
    FileUtils.rm_rf(@project)
    FileUtils.mkdir_p(@project)
    FileUtils.mkdir_p(File.join(@project, "config"))
    File.write(File.join(@project, "config", "config.yml"), "state_management:\n  max_state_chars: 10000\n")
  end

  def teardown
    FileUtils.rm_rf(@project)
  end

  def test_directive_is_included
    out = Aura::Context.assemble(@project, nil)
    assert_includes out, "AURA OS OPERATING PROTOCOL"
    assert_includes out, "MISSION"
    assert_includes out, "WORKSPACE"
    assert_includes out, "OPERATIONAL RULES"
    assert_includes out, "THE EVOLUTION LOOP"
    assert_includes out, "CONSTRAINTS"
    assert_includes out, "STATUS"
  end
end
