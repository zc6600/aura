# frozen_string_literal: true

require "yaml"
require "aura/ext/mcp/client"
require "aura/ext/mcp/sse_client"

module Aura
  module MCP
    class Manager
      @active_managers = []
      @mutex = Mutex.new

      class << self
        attr_reader :active_managers, :mutex
      end

      # Register global shutdown hook once
      at_exit do
        managers = []
        mutex.synchronize do
          managers = active_managers.dup
          active_managers.clear
        end
        managers.each(&:shutdown)
      end

      def initialize(project_path)
        @project_path = project_path
        @clients = {}
        self.class.mutex.synchronize { self.class.active_managers << self }
      end

      def shutdown
        self.class.mutex.synchronize { self.class.active_managers.delete(self) }
        @clients.each_value do |client|
          client.close if client.respond_to?(:close)
        end
        @clients.clear
      end

      def mcp_tool?(name)
        name.to_s.start_with?("mcp.")
      end

      def list_tools
        servers.flat_map do |srv|
          name = srv["name"].to_s
          next [] if name.empty?

          client = client_for(srv)
          next [] unless client

          resp = client.request("tools/list", {})
          tools = resp.dig("result", "tools") || []
          tools.map do |t|
            tool_hint = build_hint(srv, t["name"])
            {
              "name" => "mcp.#{name}.#{t['name']}",
              "tool" => t["name"],
              "server" => name,
              "description" => t["description"] || t["title"] || "",
              "input_schema" => t["inputSchema"] || t["input_schema"] || t["input"] || {},
              "auto_load" => srv.fetch("auto_load", true),
              "hint" => tool_hint,
              "raw" => t
            }
          end
        end.compact
      end

      def call_tool(full_name, args)
        server, tool = parse_tool(full_name)
        return { "status" => "failed", "error" => "invalid mcp tool: #{full_name}" } unless server && tool

        srv = servers.find { |s| s["name"].to_s == server.to_s }
        return { "status" => "failed", "error" => "mcp server not found: #{server}" } unless srv

        client = client_for(srv)
        return { "status" => "failed", "error" => "mcp server unavailable: #{server}" } unless client

        resp = client.request("tools/call", { "name" => tool, "arguments" => args || {} })
        return { "status" => "failed", "error" => resp["error"] } if resp && resp["error"]

        res = resp["result"] || {}
        text = extract_text(res["content"])
        status = res["isError"] ? "failed" : "ok"
        out = { "status" => status, "content" => text || res["content"], "mcp" => res }
        out["error"] = res["content"] if res["isError"]
        out
      end

      private

      def servers
        cfg = load_config
        list = cfg["servers"]
        list.is_a?(Array) ? list : []
      end

      def client_for(server_cfg)
        transport = (server_cfg["transport"] || server_cfg[:transport] || "stdio").to_s
        name = server_cfg["name"].to_s
        return nil if name.empty?

        @clients[name] ||= if transport == "sse"
                             url = server_cfg["url"] || server_cfg[:url]
                             headers = server_cfg["headers"] || server_cfg[:headers] || {}
                             timeout = server_cfg["timeout"] || server_cfg[:timeout] || 30
                             return nil if url.to_s.empty?

                             Aura::MCP::SSEClient.new(url, headers, timeout: timeout)
                           elsif transport == "stdio"
                             cmd = server_cfg["command"] || server_cfg[:command]
                             args = server_cfg["args"] || server_cfg[:args] || []
                             env = server_cfg["env"] || server_cfg[:env] || {}
                             timeout = server_cfg["timeout"] || server_cfg[:timeout] || 30
                             return nil if cmd.to_s.empty?

                             Aura::MCP::StdioClient.new(cmd, args, env, timeout: timeout)
                           end
      end

      def parse_tool(name)
        parts = name.to_s.split(".")
        return nil unless parts.length >= 3
        return nil unless parts[0] == "mcp"

        server = parts[1]
        tool = parts[2..].join(".")
        [server, tool]
      end

      def extract_text(content)
        return nil unless content.is_a?(Array)

        texts = content.map do |c|
          next unless c.is_a?(Hash)

          c["text"] if c["type"] == "text"
        end.compact
        return nil if texts.empty?

        texts.join("\n")
      end

      def load_config
        path = File.join(@project_path, "tools", "mcp", "config.yml")
        return {} unless File.exist?(path)

        YAML.load_file(path)
      rescue StandardError
        {}
      end

      def build_hint(server_cfg, tool_name)
        base = server_cfg["hint"] || server_cfg[:hint]
        tool_hints = server_cfg["tool_hints"] || server_cfg[:tool_hints] || {}
        tool_hint = tool_hints[tool_name] || tool_hints[tool_name.to_s]
        hints = [base, tool_hint].compact.map(&:to_s).map(&:strip).reject(&:empty?)
        return nil if hints.empty?

        hints.join("\n")
      end
    end
  end
end
