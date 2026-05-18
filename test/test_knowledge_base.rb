require "minitest/autorun"
require "aura/kernel/execution_engine"
require "aura/context"
require "fileutils"
require "json"

class TestKnowledgeBase < Minitest::Test
  def setup
    @project_path = File.expand_path("tmp_knowledge_test")
    FileUtils.rm_rf(@project_path)
    FileUtils.mkdir_p(File.join(@project_path, "config"))
    File.write(File.join(@project_path, "config", "config.yml"), {}.to_yaml)
  end

  def teardown
    FileUtils.rm_rf(@project_path)
  end

  def test_remember_fact_and_context_inclusion
    engine = Aura::Kernel::ExecutionEngine.new(@project_path)
    
    # 1. Remember a fact
    res = engine.execute("remember_fact", { "fact" => "Aura works on Ruby 3.4", "category" => "runtime" })
    assert_equal false, res[:is_error]
    assert_includes res[:content], "Aura works on Ruby 3.4"
    
    # 2. Check file existence
    knowledge_file = File.join(@project_path, ".aura_knowledge.json")
    assert File.exist?(knowledge_file)
    data = JSON.parse(File.read(knowledge_file))
    assert_includes data["runtime"], "Aura works on Ruby 3.4"
    
    # 3. Verify context assembly
    out = Aura::Context.assemble(@project_path)
    assert_includes out, "# PROJECT KNOWLEDGE BASE (Persistent Facts)"
    assert_includes out, "## Runtime"
    assert_includes out, "- Aura works on Ruby 3.4"
  end

  def test_no_knowledge_file_graceful
    out = Aura::Context.assemble(@project_path)
    refute_includes out, "# PROJECT KNOWLEDGE BASE"
  end
end
