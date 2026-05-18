require "minitest/autorun"
require "aura/context/knowledge_provider"
require "aura/context/base"
require "fileutils"
require "json"
require "yaml"

class TestKnowledgeRobustness < Minitest::Test
  def setup
    @project_path = File.expand_path("tmp_knowledge_robust")
    FileUtils.rm_rf(@project_path)
    FileUtils.mkdir_p(@project_path)
    @knowledge_file = File.join(@project_path, ".aura_knowledge.json")
  end

  def teardown
    FileUtils.rm_rf(@project_path)
  end

  def test_multi_category_knowledge
    knowledge = {
      "runtimes" => ["Ruby 3.4", "Python 3.12"],
      "commands" => ["npm run build", "rake test"],
      "style" => ["Use 2 spaces for indentation"]
    }
    File.write(@knowledge_file, JSON.pretty_generate(knowledge))

    provider = Aura::Context::KnowledgeProvider.new(@project_path)
    out = provider.provide

    assert_includes out, "# PROJECT KNOWLEDGE BASE"
    assert_includes out, "## Runtimes"
    assert_includes out, "- Ruby 3.4"
    assert_includes out, "## Commands"
    assert_includes out, "- npm run build"
    assert_includes out, "## Style"
    assert_includes out, "- Use 2 spaces for indentation"
  end

  def test_large_knowledge_volume
    # 100 facts to see if it assembles without crashing
    large_knowledge = { "facts" => (1..100).map { |i| "Fact number #{i} which is quite a long string to consume context space." } }
    File.write(@knowledge_file, JSON.pretty_generate(large_knowledge))

    provider = Aura::Context::KnowledgeProvider.new(@project_path)
    out = provider.provide
    
    assert_includes out, "Fact number 100"
    assert out.length > 5000
  end

  def test_compression_logic_respects_knowledge
    # Create a small limit (2500 chars)
    # Total context without compression will be ~4000
    
    FileUtils.mkdir_p(File.join(@project_path, "config"))
    File.write(File.join(@project_path, "config", "config.yml"), {
      "state_management" => { "max_state_chars" => 2500 }
    }.to_yaml)

    # 1. Knowledge section (~1500 chars)
    knowledge = { "large" => ["K" * 1500] }
    File.write(@knowledge_file, JSON.pretty_generate(knowledge))

    # 2. Setup Providers and DB
    # We'll use a mock DB or just a plain SQLite if needed, but Context::Base takes a 'db' object.
    # We can use our State class.
    require "aura/kernel/state"
    state = Aura::Kernel::State.new(@project_path)
    
    # Add many events (~4000 chars)
    20.times do |i|
      state.record_event({ phase: "execution", tool: "test", payload: { "output" => "E" * 200 } })
    end

    # 3. Assemble
    context = Aura::Context::Base.new(@project_path, state)
    out = context.assemble

    # 4. Verify
    assert out.length <= 2500, "Context too long: #{out.length}"
    assert_includes out, "# PROJECT KNOWLEDGE BASE"
    assert_includes out, "KKKKK"
    assert_includes out, "# AGENT STATE & MEMORY"
    
    # Verify that some events were pruned OR truncated
    # Since they are 200 chars each, they won't be truncated individually (cap 800),
    # but some should be dropped entirely to fit the 2500 limit.
    # When events are dropped, the "History" list just gets shorter.
    # The current logic doesn't add a "truncated" notice if it just drops lines.
    
    # Wait, I should check if the total number of events is less than 20
    history_section = out.split("# AGENT STATE & MEMORY").last.split("# SYSTEM & ENVIRONMENT").first
    event_count = history_section.scan("- Tool test:").size
    assert event_count < 20, "Events should be pruned, found #{event_count}"
  end
end
