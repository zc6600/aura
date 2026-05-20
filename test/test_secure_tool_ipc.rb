# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "json"
require "aura"
require "aura/kernel/execution_engine"

class TestSecureToolIpc < Minitest::Test
  def setup
    @tmp_dir = File.join(Dir.pwd, "tmp_secure_ipc_#{Time.now.to_i}")
    FileUtils.mkdir_p(@tmp_dir)
    FileUtils.mkdir_p(File.join(@tmp_dir, "tools"))
    
    # Copy native tools templates (specifically write_file and read_file) into tmp workspace
    templates_dir = File.expand_path("../lib/aura/generators/aura/app/templates/tools", __dir__)
    FileUtils.cp_r(File.join(templates_dir, "write_file"), File.join(@tmp_dir, "tools"))
    FileUtils.cp_r(File.join(templates_dir, "read_file"), File.join(@tmp_dir, "tools"))
    
    # Initialize execution engine for tmp workspace
    @engine = Aura::Kernel::ExecutionEngine.new(@tmp_dir, env_path: @tmp_dir)
  end

  def teardown
    FileUtils.rm_rf(@tmp_dir)
  end

  def test_small_payload_succeeds_and_uses_argv
    # Payload is small (<64KB). Verification: write_file works.
    res = @engine.execute("write_file", { "file_path" => "small.txt", "content" => "Small content" })
    assert_equal "ok", res["status"]
    assert_equal "Small content", File.read(File.join(@tmp_dir, "small.txt"))
  end

  def test_large_payload_succeeds_using_stdin_without_argv_overflow
    # Create a large payload (>64KB)
    large_content = "A" * 70000
    
    # Invoke write_file with large content.
    # Since it is >64KB, ExecutionEngine will omit it from command line arguments.
    # The python write_file script should fallback to sys.stdin.read() and successfully process it.
    res = @engine.execute("write_file", { "file_path" => "large.txt", "content" => large_content })
    assert_equal "ok", res["status"]
    assert_equal large_content, File.read(File.join(@tmp_dir, "large.txt"))
    
    # Read the file back via read_file tool to verify reading works too
    res_read = @engine.execute("read_file", { "file_path" => "large.txt" })
    assert_equal "ok", res_read["status"]
    assert_equal large_content, res_read["content"]
  end

  def test_symlink_traversal_outside_workspace_is_blocked
    # Create a symlink in the workspace pointing to a file outside the workspace
    outside_file = File.join(Dir.pwd, "tmp_outside_#{Time.now.to_i}.txt")
    File.write(outside_file, "Secret outside information")
    
    # Create symlink inside @tmp_dir
    symlink_path = File.join(@tmp_dir, "bad_link.txt")
    File.symlink(outside_file, symlink_path)
    
    begin
      # Try to read via read_file tool using the symlink.
      # The target path resolved by os.path.realpath(symlink_path) will be outside @tmp_dir.
      # The path validation should detect and block this!
      res = @engine.execute("read_file", { "file_path" => "bad_link.txt" })
      assert_equal "failed", res["status"]
      assert_match(/Security Error/, res["error"])
      
      # Try to write via write_file tool using the symlink.
      res_write = @engine.execute("write_file", { "file_path" => "bad_link.txt", "content" => "malicious overwrite" })
      assert_equal "failed", res_write["status"]
      assert_match(/Security Error/, res_write["error"])
      
      # Verify original outside file was NOT overwritten
      assert_equal "Secret outside information", File.read(outside_file)
    ensure
      FileUtils.rm_f(outside_file)
    end
  end
end
