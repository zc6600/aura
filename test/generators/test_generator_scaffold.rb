require "minitest/autorun"
require "fileutils"

class TestGeneratorScaffold < Minitest::Test
  def setup
    @root = Dir.pwd
    @app  = File.join(@root, "tmp_app_scaffold")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_app_scaffold")
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_scaffold_created
    assert File.exist?(File.join(@app, "config", "config.yml")), "missing config.yml"
    %w[logic.py manifest.json test.py logic.py.hint].each do |f|
      assert File.exist?(File.join(@app, "tools", "read_file", f)), "missing #{f}"
    end
  end
end

