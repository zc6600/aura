# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "aura"
require "aura/context/directive_provider"
require "aura/cli/commands/skills_command"

class TestSkills < Minitest::Test
  def setup
    @tmp_dir = File.join(Dir.pwd, "tmp_test_skills_#{Time.now.to_i}")
    FileUtils.mkdir_p(File.join(@tmp_dir, "skills", "test-skill"))
    FileUtils.mkdir_p(File.join(@tmp_dir, ".aura"))
    
    # Create a test skill with front-matter
    @skill_content = <<~MD
      ---
      name: test-skill
      description: This is a verified test skill.
      ---
      # Test Skill Guide
      Perform task under test conditions in {{project_path}}.
    MD
    File.write(File.join(@tmp_dir, "skills", "test-skill", "SKILL.md"), @skill_content)
  end

  def teardown
    FileUtils.rm_rf(@tmp_dir)
    ENV["AURA_ACTIVE_SKILL"] = nil
  end

  def test_directive_provider_resolves_active_skill
    provider = Aura::Context::DirectiveProvider.new(@tmp_dir, { active_skill: "test-skill" })
    provided = provider.provide
    
    # Verify front-matter is stripped
    refute_match(/---/, provided)
    refute_match(/description:/, provided)
    
    # Verify description content and template placeholder replacement
    assert_match(/# Test Skill Guide/, provided)
    assert_match(/Perform task under test conditions in #{@tmp_dir}/, provided)
  end

  def test_directive_provider_falls_back_to_system_prompt_when_no_active_skill
    # Create system.md
    File.write(File.join(@tmp_dir, "skills", "system.md"), "Standard System Instructions")
    
    provider = Aura::Context::DirectiveProvider.new(@tmp_dir)
    provided = provider.provide
    
    assert_equal "Standard System Instructions\n", provided
  end

  def test_skills_command_lists_available_skills
    cli = Aura::Commands::SkillsCommand.new
    out, _err = capture_io do
      cli.list(@tmp_dir)
    end
    
    assert_match(/Available Agent Skills/, out)
    assert_match(/\* test-skill/, out)
    assert_match(/This is a verified test skill/, out)
  end

  def test_directive_provider_resolves_framework_default_skill
    require "tmpdir"
    Dir.mktmpdir("aura_outside_") do |outside_dir|
      provider = Aura::Context::DirectiveProvider.new(outside_dir, { active_skill: "find-skills" })
      provided = provider.provide
      
      assert_match(/Find Skills/, provided)
      assert_match(/The Skills CLI/, provided)
    end
  end
end
