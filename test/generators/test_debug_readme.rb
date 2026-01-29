require "minitest/autorun"
require "fileutils"

class TestDebugReadme < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_debug_readme")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_debug_readme")
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_readme_generated_with_debug_commands
    path = File.join(@app, "AURA_README.md")
    assert File.exist?(path), "AURA_README.md not generated"
    s = File.read(path)
    assert_includes s, "bin/aura context ."
    assert_includes s, "tools inspect"
    assert_includes s, "kernel once"
  end
end

