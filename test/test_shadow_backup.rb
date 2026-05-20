# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "open3"
require "aura"
require "aura/kernel/shadow_backup"

class TestShadowBackup < Minitest::Test
  def setup
    # Create temp workspace
    @tmp_dir = File.join(Dir.pwd, "tmp_test_workspace_#{Time.now.to_i}")
    FileUtils.mkdir_p(@tmp_dir)
    FileUtils.mkdir_p(File.join(@tmp_dir, ".aura"))

    # Initialize Git repo in the workspace to test git status detection
    Open3.capture3("git init", chdir: @tmp_dir)
    Open3.capture3("git config user.name \"Test User\"", chdir: @tmp_dir)
    Open3.capture3("git config user.email \"test@user.com\"", chdir: @tmp_dir)
  end

  def teardown
    FileUtils.rm_rf(@tmp_dir)
  end

  def test_shadow_backup_creates_git_repo_and_copies_modified_files
    backup = Aura::Kernel::ShadowBackup.new(@tmp_dir)

    # Create a dummy file in workspace
    test_file_path = File.join(@tmp_dir, "test.txt")
    File.write(test_file_path, "Hello world original")

    # Commit it to parent git so it's a known tracked file
    Open3.capture3("git add test.txt", chdir: @tmp_dir)
    Open3.capture3("git commit -m \"Initial project commit\"", chdir: @tmp_dir)

    # Modify it to trigger git status M state
    File.write(test_file_path, "Hello world modified")

    # Run backup record
    backup.record_changes("write_file")

    # Verify shadow directory was created
    shadow_path = File.join(@tmp_dir, ".aura", "shadow")
    assert File.directory?(shadow_path)
    assert File.directory?(File.join(shadow_path, ".git"))

    # Verify modified file was copied
    shadow_file = File.join(shadow_path, "test.txt")
    assert File.exist?(shadow_file)
    assert_equal "Hello world modified", File.read(shadow_file)

    # Verify a commit was recorded in the shadow repository
    out, _err, status = Open3.capture3("git log -1 --pretty=%s", chdir: shadow_path)
    assert status.success?
    assert_match(/\[Aura\] Tool execution: write_file/, out)
  end

  def test_shadow_backup_excludes_large_files
    backup = Aura::Kernel::ShadowBackup.new(@tmp_dir)

    # Create a large file (> 1MB)
    large_file_path = File.join(@tmp_dir, "large.dat")
    File.write(large_file_path, "A" * (1024 * 1024 + 100)) # 1MB + 100 bytes

    # Run record
    backup.record_changes("write_file", { "file_path" => "large.dat" })

    # Verify it was NOT copied
    shadow_file = File.join(@tmp_dir, ".aura", "shadow", "large.dat")
    refute File.exist?(shadow_file)
  end

  def test_shadow_backup_excludes_gitignored_files
    backup = Aura::Kernel::ShadowBackup.new(@tmp_dir)

    # Create a gitignore rule
    File.write(File.join(@tmp_dir, ".gitignore"), "ignored.txt\n")

    # Create an ignored file
    ignored_file_path = File.join(@tmp_dir, "ignored.txt")
    File.write(ignored_file_path, "Secret content")

    # Run record
    backup.record_changes("write_file")

    # Verify it was NOT copied
    shadow_file = File.join(@tmp_dir, ".aura", "shadow", "ignored.txt")
    refute File.exist?(shadow_file)
  end
end
