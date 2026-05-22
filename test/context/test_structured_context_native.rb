require "minitest/autorun"
require "fileutils"
require "json"
require "aura"
require "aura/context"
require "aura/llm/prompts/compose"
require "aura/llm/adapters/openai"

class DummyDb
  def get_latest_summary
    "Summary text"
  end
  def get_active_variables
    { "goal" => "build" }
  end
  def get_recent_events
    "recent events"
  end
end

class TestStructuredContextNative < Minitest::Test
  def setup
    @project = File.join(Dir.pwd, "tmp_ctx_project_native")
    FileUtils.rm_rf(@project)
    FileUtils.mkdir_p(@project)
    FileUtils.mkdir_p(File.join(@project, ".aura", "tools", "t1"))
    FileUtils.mkdir_p(File.join(@project, "knowledge"))
    
    # Write t1 manifest. skip_test to bypass required python test files
    File.write(File.join(@project, ".aura", "tools", "t1", "manifest.json"), { 
      name: "t1", 
      description: "Dummy Tool 1", 
      permissions: { fs: "ro" }, 
      auto_load: true,
      skip_test: true,
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      }
    }.to_json)
    
    FileUtils.mkdir_p(File.join(@project, ".aura", "config"))
    File.write(File.join(@project, ".aura", "config", "config.yml"), <<~YAML)
      tool_protocol:
        required_files:
          - logic.py
          - manifest.json
      state_management:
        max_state_chars: 10000
    YAML
  end

  def teardown
    FileUtils.rm_rf(@project)
  end

  def test_payload_delegation_and_string_methods
    sections = {
      directive: "# AURA OS OPERATING PROTOCOL\ncontent directive",
      active: "# ACTIVE TOOLS (Ready to use)\ncontent active",
      state: "# AGENT STATE & MEMORY\ncontent state"
    }
    tools = [{ name: "t1", description: "desc1", input_schema: {} }]
    
    payload = Aura::Context::Payload.new(sections, tools)
    
    # 1. Accessors
    assert_equal sections, payload.sections
    assert_equal tools, payload.tools
    
    # 2. to_s and to_str delegation
    str = payload.to_s
    assert_match(/content directive/, str)
    assert_match(/content active/, str)
    assert_match(/content state/, str)
    
    # 3. String method delegation
    assert payload.include?("content directive")
    assert_equal 3, payload.split("\n\n").size
    assert_equal str.length, payload.length
    assert_equal str.gsub("content", "modified"), payload.gsub("content", "modified")
  end

  def test_to_markdown_excluding
    sections = {
      directive: "# AURA OS OPERATING PROTOCOL\ncontent directive",
      active: "# ACTIVE TOOLS (Ready to use)\ncontent active",
      state: "# AGENT STATE & MEMORY\ncontent state"
    }
    tools = [{ name: "t1", description: "desc1", input_schema: {} }]
    payload = Aura::Context::Payload.new(sections, tools)
    
    excluded_str = payload.to_markdown_excluding([:active])
    assert_includes excluded_str, "content directive"
    assert_includes excluded_str, "content state"
    refute_includes excluded_str, "content active"
  end

  def test_assemble_returns_payload_with_active_tools
    db = DummyDb.new
    out = Aura::Context.assemble(@project, db)
    
    assert_instance_of Aura::Context::Payload, out
    t1_tool = out.tools.find { |t| t[:name] == "t1" }
    refute_nil t1_tool
    assert_equal "Dummy Tool 1", t1_tool[:description]
  end

  def test_compose_messages_and_tools
    sections = {
      directive: "# AURA OS OPERATING PROTOCOL\ncontent directive",
      active: "# ACTIVE TOOLS (Ready to use)\ncontent active",
      state: "# AGENT STATE & MEMORY\ncontent state"
    }
    tools = [{ name: "t1", description: "desc1", input_schema: { "properties" => { "x" => { "type" => "string" } } } }]
    payload = Aura::Context::Payload.new(sections, tools)

    # Always use native tools - text-injection removed
    messages, native_tools = Aura::LLM::Prompts::Compose.messages_and_tools(payload, "mygoal")
    
    # Verify native tools are formatted correctly
    refute_nil native_tools
    assert_equal 1, native_tools.size
    assert_equal "t1", native_tools[0][:function][:name]
    assert_equal "desc1", native_tools[0][:function][:description]
    assert_equal "object", native_tools[0][:function][:parameters][:type]
    
    # Verify that the active tools text was excluded from messages to avoid duplication
    refute_includes messages[0][:content], "# ACTIVE TOOLS (Ready to use)"
    refute_includes messages[0][:content], "content active"
    assert_includes messages[0][:content], "content directive"
  end

  def test_openai_adapter_passes_tools_option
    adapter = Aura::LLM::Adapters::OpenAI.new(api_base: "http://mock-api.com", api_key: "dummy", model: "gpt-4")
    
    mock_response = Object.new
    mock_response.define_singleton_method(:body) do
      { choices: [{ message: { content: "dummy text" } }] }.to_json
    end
    
    $mock_response = mock_response
    $last_request = nil
    
    class << Net::HTTP
      alias_method :original_start, :start rescue nil
      def start(*args, &block)
        mock_http = Object.new
        mock_http.define_singleton_method(:request) do |req|
          $last_request = req
          $mock_response
        end
        yield(mock_http)
      end
    end
    
    begin
      options = { tools: [{ type: "function", function: { name: "t1" } }] }
      res = adapter.complete([{ role: "user", content: "hi" }], options)
      
      assert_equal "dummy text", res[:content]
      refute_nil $last_request
      body_parsed = JSON.parse($last_request.body)
      assert_equal "auto", body_parsed["tool_choice"]
      assert_equal "t1", body_parsed["tools"][0]["function"]["name"]
    ensure
      class << Net::HTTP
        if method_defined?(:original_start)
          alias_method :start, :original_start
          remove_method :original_start
        end
      end
    end
  end
end
