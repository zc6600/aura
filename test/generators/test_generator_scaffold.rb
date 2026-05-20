require "minitest/autorun"
require "fileutils"

class TestGeneratorScaffold < Minitest::Test
  def setup
    @root = Dir.pwd
    @app  = File.join(@root, "tmp_app_scaffold")
    FileUtils.rm_rf(@app)
    FileUtils.mkdir_p(@app)
    Dir.chdir(@app) do
      system("ruby ../bin/aura new")
    end
  end

  def teardown
    Dir.chdir(@root)
    FileUtils.rm_rf(@app)
  end

  def test_scaffold_created
    hidden = File.join(@app, ".aura")
    assert File.exist?(File.join(hidden, ".aura", "config", "config.yml")), "missing config.yml"
    %w[logic.py manifest.json test.py logic.py.hint].each do |f|
      assert File.exist?(File.join(hidden, "tools", "read_file", f)), "missing #{f}"
    end
  end
end

