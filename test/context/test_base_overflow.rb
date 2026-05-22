require "minitest/autorun"
require "fileutils"
require "aura"
require "aura/context"

class TestBaseOverflow < Minitest::Test
  def setup
    @project = File.join(Dir.pwd, "tmp_overflow_project")
    FileUtils.rm_rf(@project)
    FileUtils.mkdir_p(@project)
    FileUtils.mkdir_p(File.join(@project, ".aura", "config"))
    File.write(File.join(@project, ".aura", "config", "config.yml"), <<~YML)
    state_management:
      max_state_chars: 300
      keep_last_summary_n_steps: 20
    context_compression:
      event_max_chars: 50
      event_min_count_threshold: 3
      summary_trim_step: 5
    YML
    File.write(File.join(@project, "AURA_README.md"), "This is a long workspace rule text.")
  end

  def teardown
    FileUtils.rm_rf(@project)
  end

  def test_overflow_auto_compresses_state_with_event_and_summary_rules
    require "aura/kernel/state"
    st = Aura::Kernel::State.new(@project)
    # commit multiple one-line summaries
    12.times do |i|
      st.commit_summary("S#{i + 1}")
    end
    # record 5 long events (result field very long)
    5.times do |i|
      st.record_event({ phase: "execution", tool: "t", result: "EVENT#{i + 1} " + ("X" * 2000) })
    end
    assert_raises(Aura::Context::ContextOverflowError) do
      Aura::Context.assemble(@project, st)
    end
  end
end
