require "minitest/autorun"
require "fileutils"

class TestMcpToolProvider < Minitest::Test
  def setup
    @root = Dir.pwd
    @app = File.join(@root, "tmp_mcp_tool_provider")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_mcp_tool_provider")
    FileUtils.mkdir_p(File.join(@app, "tools", "mcp"))
    server_code = <<~RUBY
      require "json"
      STDOUT.sync = true
      while (line = STDIN.gets)
        line = line.strip
        next if line.empty?
        msg = JSON.parse(line) rescue nil
        next unless msg
        id = msg["id"]
        method = msg["method"]
        if method == "initialize"
          resp = { "jsonrpc" => "2.0", "id" => id, "result" => { "capabilities" => { "tools" => { "listChanged" => false } } } }
          puts JSON.generate(resp)
        elsif method == "tools/list"
          resp = { "jsonrpc" => "2.0", "id" => id, "result" => { "tools" => [ { "name" => "ping", "description" => "Ping tool", "inputSchema" => { "type" => "object", "properties" => {}, "required" => [] } } ] } }
          puts JSON.generate(resp)
        elsif method == "tools/call"
          resp = { "jsonrpc" => "2.0", "id" => id, "result" => { "content" => [ { "type" => "text", "text" => "pong" } ], "isError" => false } }
          puts JSON.generate(resp)
        end
      end
    RUBY
    config = <<~YAML
      servers:
        - name: "test"
          transport: "stdio"
          command: "ruby"
          args:
            - "-e"
            - #{server_code.dump}
          env: {}
          timeout: 5
          auto_load: true
    YAML
    File.write(File.join(@app, "tools", "mcp", "config.yml"), config)
  end

  def teardown
    FileUtils.rm_rf(@app)
  end

  def test_tool_provider_includes_mcp_tools
    require "aura/context/tool_provider"
    require "aura/kernel/state"
    db = Aura::Kernel::State.new(@app)
    provider = Aura::Context::ToolProvider.new(@app, state: db)
    text = provider.provide
    assert_includes text, "mcp.test.ping"
  end
end
