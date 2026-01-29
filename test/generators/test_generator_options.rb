require "minitest/autorun"
require "fileutils"

class TestGeneratorOptions < Minitest::Test
  def test_pretend_skips_writes
    app = "tmp_app_pretend"
    FileUtils.rm_rf(app)
    system("ruby bin/aura new #{app} -p")
    refute Dir.exist?(app), "pretend should not create files"
  end

  def test_force_overwrites_files
    app = "tmp_app_force"
    FileUtils.mkdir_p(File.join(app, "config"))
    File.write(File.join(app, "config", "config.yml"), "custom")
    system("ruby bin/aura new #{app} -f")
    content = File.read(File.join(app, "config", "config.yml"))
    refute_equal "custom", content
  ensure
    FileUtils.rm_rf(app)
  end
end

