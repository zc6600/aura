require "minitest/autorun"
require "fileutils"

class TestCallSummaryPersist < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_summary_persist")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_summary_persist")
    cfg = File.join(@app, ".aura", "config", "config.yml")
    content = File.read(cfg)
    if content.include?("call_summary:")
      content = content.gsub(/max_chars:\s*\d+/, "max_chars: 20")
    else
      content << "\n\ntool_protocol:\n  call_summary:\n    suggested_chars: 120\n    max_chars: 20\n"
    end
    content = content.gsub(/max_state_chars:\s*\d+/, "max_state_chars: 10000")
    File.write(cfg, content)
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_summary_is_truncated_and_persisted
    require "aura/kernel"
    runner = Aura::Kernel::Runner.new(@app)
    long = "这是一个超过二十字的摘要文本，用于测试截断。"
    payload = { "tool" => "read_file", "args" => { "file_path" => ".aura/config/config.yml", "context_permissions" => ["."] }, "summary" => long }
    out = runner.run_call(payload)
    assert_includes ["ok", "success"], out["status"].to_s

    require "aura/kernel/state"
    st = Aura::Kernel::State.new(@app)
    s = st.get_latest_summary
    assert s
    assert s.length <= 20
    ctx = Aura::Context.assemble(@app, st)
    assert_includes ctx, "History"
  end
end
