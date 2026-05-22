require "minitest/autorun"
require "aura"
require "aura/kernel/state"
require "aura/kernel/narrative_service"
require "fileutils"
require "json"
require "yaml"

class TestNarrativeMetabolism < Minitest::Test
  def setup
    @project_path = File.expand_path("tmp_narrative_test")
    FileUtils.rm_rf(@project_path)
    FileUtils.mkdir_p(File.join(@project_path, ".aura", "config"))
    FileUtils.mkdir_p(File.join(@project_path, ".aura", "state"))
    
    # Configure metabolism to trigger easily
    File.write(File.join(@project_path, ".aura", "config", "config.yml"), {
      "state_management" => {
        "recent_events_n" => 2,
        "max_state_chars" => 10000
      }
    }.to_yaml)
  end

  def teardown
    FileUtils.rm_rf(@project_path)
  end

  class MockNarrativeService
    def initialize(_path); end
    def synthesize(_events)
      "Mocked Narrative Summary"
    end
  end

  def test_metabolism_triggers_narrative
    state = Aura::Kernel::State.new(@project_path)
    
    # Stub NarrativeService to avoid actual LLM calls
    Aura::Kernel.const_set(:NarrativeServiceBackup, Aura::Kernel::NarrativeService)
    Aura::Kernel.send(:remove_const, :NarrativeService)
    Aura::Kernel.const_set(:NarrativeService, MockNarrativeService)

    begin
      # Record many events to trigger metabolism (threshold is keep*5 = 10)
      15.times do |i|
        state.record_event({ phase: "execution", tool: "test", input: "input #{i}" })
      end
      
      state.metabolize_if_needed
      
      # Check if narrative summary was recorded
      summaries = state.get_recent_summaries(5)
      assert_includes summaries, "Metabolism: Narrative Summary - Mocked Narrative Summary"
    ensure
      # Restore real service
      Aura::Kernel.send(:remove_const, :NarrativeService)
      Aura::Kernel.const_set(:NarrativeService, Aura::Kernel::NarrativeServiceBackup)
    end
  end
end
