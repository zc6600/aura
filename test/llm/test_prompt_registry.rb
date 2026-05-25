require "minitest/autorun"
require "fileutils"
require "aura"
require "aura/llm/prompts/registry"

class TestPromptRegistry < Minitest::Test
  def setup
    @tmp_dir = File.expand_path("../../tmp_prompt_registry_test", __dir__)
    FileUtils.rm_rf(@tmp_dir)
    FileUtils.mkdir_p(@tmp_dir)
    FileUtils.mkdir_p(File.join(@tmp_dir, ".aura"))
    Aura::LLM::Prompts::Registry.clear_cache!
  end

  def teardown
    FileUtils.rm_rf(@tmp_dir)
    Aura::LLM::Prompts::Registry.clear_cache!
  end

  def test_cached_file_reading_and_invalidation
    file_path = File.join(@tmp_dir, "test.md")
    
    # Initial write
    File.write(file_path, "Initial Content")
    content1 = Aura::LLM::Prompts::Registry.read_file_cached(file_path)
    assert_equal "Initial Content\n", content1

    # Check cache hit (content shouldn't change even if file modified without mtime change - though unlikely, let's check mtime update)
    # Write new content and force mtime forward
    File.write(file_path, "Updated Content")
    new_time = Time.now + 10
    File.utime(new_time, new_time, file_path)

    content2 = Aura::LLM::Prompts::Registry.read_file_cached(file_path)
    assert_equal "Updated Content\n", content2
  end

  def test_stripping_frontmatter
    file_path = File.join(@tmp_dir, "frontmatter.md")
    File.write(file_path, "---\nname: test\n---\nActual Body")
    content = Aura::LLM::Prompts::Registry.read_file_cached(file_path)
    assert_equal "Actual Body\n", content
  end

  def test_composition_priority_legacy_file
    # If legacy skills/system.md exists, resolve uses it
    skills_dir = File.join(@tmp_dir, "skills")
    FileUtils.mkdir_p(skills_dir)
    legacy_file = File.join(skills_dir, "system.md")
    File.write(legacy_file, "# AURA OS OPERATING PROTOCOL\nLegacy Override")

    resolved = Aura::LLM::Prompts::Registry.resolve(:standard, @tmp_dir)
    assert_includes resolved, "Legacy Override"
  end

  def test_composition_priority_modular_overrides
    # Override a single section e.g. 03_operational_rules.md
    override_dir = File.join(@tmp_dir, "prompts", "system")
    FileUtils.mkdir_p(override_dir)
    
    rules_file = File.join(override_dir, "03_operational_rules.md")
    File.write(rules_file, "Custom Workspace Rules")

    resolved = Aura::LLM::Prompts::Registry.resolve(:standard, @tmp_dir)
    assert_includes resolved, "Custom Workspace Rules"
    # Other sections should fall back to default
    assert_includes resolved, "primary operator and architect"
  end

  def test_prompt_validation
    # Test valid prompt
    valid_prompt = "Output JSON with tool and args. {{project_path}}"
    assert_empty Aura::LLM::Prompts::Registry.validate_prompt(valid_prompt)

    # Missing JSON keyword
    no_json = "Output response with tool and args."
    issues = Aura::LLM::Prompts::Registry.validate_prompt(no_json)
    assert_includes issues.join, "JSON"

    # Missing tool/args
    no_tool = "Output JSON response. {{project_path}}"
    issues = Aura::LLM::Prompts::Registry.validate_prompt(no_tool)
    assert_includes issues.join, "tool"

    # Missing project_path in double brackets placeholder
    bad_placeholder = "Output JSON tool and args. {{unsupported_placeholder}}"
    issues = Aura::LLM::Prompts::Registry.validate_prompt(bad_placeholder)
    assert_includes issues.join, "Contains unresolved template placeholders"
  end
end
