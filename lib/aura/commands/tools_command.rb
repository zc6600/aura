# frozen_string_literal: true

require "thor"
require "yaml"
require "json"
require "open3"

module Aura
  module Commands
    class ToolsCommand < Thor
      desc "inspect NAME", "Inspect a tool by name and print structured metadata"
      method_option :pretty, type: :boolean, aliases: "-p", default: false, desc: "Pretty-print JSON output"
      method_option :human,  type: :boolean, aliases: "-H", default: false, desc: "Human-readable summary"
      map "inspect" => :tool_inspect
      def tool_inspect(name)
        py = runtime_python
        logic = File.join("tools", "inspect_tool", "logic.py")
        unless File.exist?(logic)
          puts "inspect_tool not found under tools/inspect_tool/logic.py"
          return
        end
        payload = { "tool_name" => name }.to_json
        out, err, status = Open3.capture3(py, logic, payload)
        text = status.success? ? out : (err.empty? ? out : err)
        begin
          data = JSON.parse(text)
          if options[:human]
            puts human_tool_inspect(data)
          elsif options[:pretty]
            puts JSON.pretty_generate(data)
          else
            puts text
          end
        rescue JSON::ParserError
          puts text
        end
      end

      no_commands do
        def runtime_python
          path = File.join(Dir.pwd, "config", "config.yml")
          begin
            data = File.exist?(path) ? YAML.load_file(path) : {}
            data.dig("tool_protocol", "runtimes", "python") || "python3"
          rescue StandardError
            "python3"
          end
        end

        def human_tool_inspect(data)
          lines = []
          lines << "Tool: #{data["tool"]}"
          st = data["status"]
          lines << "Status: #{st}" if st
          man = data["manifest"] || {}
          lines << "Name: #{man["name"]}" if man["name"]
          lines << "Description: #{man["description"]}" if man["description"]
          runtime = man["runtime"]
          lines << "Runtime: #{runtime}" if runtime
          if man["permissions"]
            lines << "Permissions: #{man["permissions"].to_json}"
          end
          files = data["files"] || []
          lines << "Files: #{files.join(", ")}" unless files.empty?
          hint = data["hint"] || (data["magic_hints"]&.first)
          lines << "Hint: #{hint}" if hint
          if (schema = man["input_schema"]).is_a?(Hash)
            props = schema["properties"] || {}
            req   = schema["required"] || []
            lines << "Input keys: #{props.keys.join(", ")}" unless props.empty?
            lines << "Required: #{req.join(", ")}" unless req.empty?
          end
          lines.join("\n")
        end
      end
    end
  end
end
