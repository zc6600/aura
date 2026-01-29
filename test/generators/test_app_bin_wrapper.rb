require "minitest/autorun"
require "fileutils"

class TestAppBinWrapper < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_app_bin_wrapper")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_app_bin_wrapper")
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_bin_aura_exists_and_runs
    assert File.exist?(File.join(@app, "bin", "aura")), "bin/aura was not generated"

    Dir.chdir(@app) do
      version_out = `bin/aura version`
      assert_match(/Aura /, version_out)

      inspect_out = `bin/aura tools inspect inspect_tool`
      assert_includes inspect_out, '"tool": "inspect_tool"'
    end
  end
end

