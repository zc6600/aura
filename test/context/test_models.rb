# frozen_string_literal: true

require "minitest/autorun"
require "aura"
require "aura/context/prompt"
require "aura/context/env_provider"
require "aura/context/memory"
require "aura/context/payload"

class TestContextModels < Minitest::Test
  def test_prompt_model
    # Test normalization & default behaviors
    prompt = Aura::Context::Prompt.new("  kernel  \n", nil, "\n  task  ")
    assert_equal "kernel", prompt.kernel_prompt
    assert_equal "", prompt.workspace_prompt
    assert_equal "task", prompt.task_prompt

    # Test markdown concatenation order: kernel -> workspace -> task
    prompt2 = Aura::Context::Prompt.new("kernel", "workspace", "task")
    assert_equal "kernel\n\nworkspace\n\ntask", prompt2.to_markdown
    assert_equal prompt2.to_markdown, prompt2.to_s
    assert_equal prompt2.to_markdown, prompt2.to_str
  end

  def test_env_provider_model
    env = Aura::Context::EnvProvider.new(
      overview: "  overview  ",
      lsp: nil,
      knowledge: "\n  knowledge  "
    )
    assert_equal "overview", env.overview
    assert_equal "", env.lsp
    assert_equal "knowledge", env.knowledge

    assert_equal "overview\n\nknowledge", env.to_markdown
    assert_equal env.to_markdown, env.to_s
  end

  def test_memory_model
    mem = Aura::Context::Memory.new(state: "  state  ")
    assert_equal "state", mem.state
    assert_equal "state", mem.to_markdown
    assert_equal mem.to_markdown, mem.to_s
  end

  def test_payload_new_signature
    prompt = Aura::Context::Prompt.new("kernel", "workspace", "task")
    env = Aura::Context::EnvProvider.new(overview: "overview", lsp: "lsp", knowledge: "knowledge")
    mem = Aura::Context::Memory.new(state: "state")
    tools = [{ name: "tool1" }]
    options = { directive_mode: :ralph_developer }

    payload = Aura::Context::Payload.new(prompt, env, mem, tools, options, { directive: "kernel", workspace: "workspace" })

    assert_equal prompt, payload.prompt
    assert_equal env, payload.env_provider
    assert_equal mem, payload.memory
    assert_equal tools, payload.tools
    assert_equal "kernel", payload.sections[:directive]
  end

  def test_payload_old_signature_compatibility
    sections = {
      directive: "kernel",
      workspace: "workspace",
      task: "task",
      env: "env",
      lsp: "lsp",
      knowledge: "knowledge",
      state: "state"
    }
    tools = [{ name: "tool1" }]
    options = { directive_mode: :ralph_developer }

    payload = Aura::Context::Payload.new(sections, tools, options)

    # Verify that the compatibility layer successfully constructed the sub-models
    assert_instance_of Aura::Context::Prompt, payload.prompt
    assert_instance_of Aura::Context::EnvProvider, payload.env_provider
    assert_instance_of Aura::Context::Memory, payload.memory

    assert_equal "kernel", payload.prompt.kernel_prompt
    assert_equal "workspace", payload.prompt.workspace_prompt
    assert_equal "task", payload.prompt.task_prompt

    assert_equal "env", payload.env_provider.overview
    assert_equal "lsp", payload.env_provider.lsp
    assert_equal "knowledge", payload.env_provider.knowledge

    assert_equal "state", payload.memory.state

    assert_equal tools, payload.tools
  end
end
