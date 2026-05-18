require "minitest/autorun"
require "aura/kernel/narrative_service"
require "aura/llm/client"
require "fileutils"

class TestNarrativeServiceEdgeCases < Minitest::Test
  def setup
    @project_path = File.expand_path("tmp_narrative_edges")
    FileUtils.mkdir_p(@project_path)
    @service = Aura::Kernel::NarrativeService.new(@project_path)
  end

  def teardown
    FileUtils.rm_rf(@project_path)
  end

  def test_synthesize_empty_events
    result = @service.synthesize([])
    assert_equal "No events to summarize.", result
  end

  class MockErrorClient
    def initialize(*args); end
    def complete(*args)
      raise "API Error Simulation"
    end
  end

  def test_synthesize_llm_failure_handling
    # We want to verify that NarrativeService rescues exceptions and returns a fallback message
    # To do this, we need to ensure Aura::LLM::Client.new returns our mock that raises.
    
    Aura::LLM.const_set(:ClientBackup, Aura::LLM::Client)
    Aura::LLM.send(:remove_const, :Client)
    Aura::LLM.const_set(:Client, MockErrorClient)

    begin
      events = [{ "payload" => { "out" => "test" }, "tool" => "echo", "phase" => "execution" }]
      result = @service.synthesize(events)
      assert_includes result, "Metabolism synthesis failed: API Error Simulation"
    ensure
      Aura::LLM.send(:remove_const, :Client)
      Aura::LLM.const_set(:Client, Aura::LLM::ClientBackup)
    end
  end
end
