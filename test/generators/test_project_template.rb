require "minitest/autorun"
require "fileutils"

class TestProjectTemplate < Minitest::Test
  def setup
    @root = Dir.pwd
    @app = File.join(@root, "tmp_app_project_template")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_app_project_template -T project")
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_project_template_files
    assert File.exist?(File.join(@app, "prompts", "README.md")), "missing prompts/README.md"
    assert File.exist?(File.join(@app, "templates", "README.md")), "missing templates/README.md"
  end
end
