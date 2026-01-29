require "minitest/autorun"
require "fileutils"
require "aura/context"

class TestBaseOverflow < Minitest::Test
  def setup
    @project = File.join(Dir.pwd, "tmp_overflow_project")
    FileUtils.rm_rf(@project)
    FileUtils.mkdir_p(@project)
    FileUtils.mkdir_p(File.join(@project, "config"))
    # Set very small max_state_chars to trigger overflow
    File.write(File.join(@project, "config", "config.yml"), "state_management:\n  max_state_chars: 10\n")
    File.write(File.join(@project, "AURA_README.md"), "This is a long workspace rule text.")
  end

  def teardown
    FileUtils.rm_rf(@project)
  end

  def test_overflow_raises_error
    assert_raises(Aura::Context::ContextOverflowError) do
      Aura::Context.assemble(@project, nil)
    end
  end
end
