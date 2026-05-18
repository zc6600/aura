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
              puts human_tool_inspect(data, name)
            elsif options[:pretty]
              puts JSON.pretty_generate(data)
            else
              puts text
            end
          rescue JSON::ParserError
            puts text
          end
        end

      desc "list [PROJECT_PATH]", "List all tools and their status"
      method_option :human,  type: :boolean, aliases: "-H", default: false, desc: "Human-readable output"
      def list(project_path = ".")
        require "aura/kernel/tool_validator"
        require "aura/kernel/registry"
        project = File.expand_path(project_path)
        registry = Aura::Kernel::ToolRegistry.new(project)
        validator = Aura::Kernel::ToolValidator.new(project, registry, nil)
        items = registry.all_tools.map do |name|
          st = validator.status_for(name)
          { "tool" => name, "state" => st[:state], "reason" => st[:reason], "verified" => st[:verified] }
        end
        if options[:human]
          puts items.map { |i| "#{i["tool"]}: #{i["state"]}#{i["reason"] ? " (#{i["reason"]})" : ""}" }.join("\n")
        else
          puts JSON.pretty_generate(items)
        end
      end

      desc "generate_group NAME [SUBTOOLS...]", "Generate a hierarchical tool group"
      def generate_group(name, *subtools)
        require "aura/generators/tool_group_generator"
        gen = Aura::Generators::ToolGroupGenerator.new([name, subtools], {}, {})
        gen.invoke_all
      end

      desc "add TOOL_NAME", "Install an optional tool into your project"
      def add(tool_name)
        require "aura/generators/tools_generator"
        Aura::Generators::ToolsGenerator.start([tool_name])
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

        def human_tool_inspect(data, requested_name = nil)
          lines = []
          tname = data["tool"] || requested_name.to_s
          lines << "Tool: #{tname}"
          st = data["status"]
          lines << "Status: #{st}" if st
          if data["error"]
            lines << "Error: #{data["error"]}"
          end
          if data["code"]
            lines << "Code: #{data["code"]}"
          end
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
          if (tree = data["tree"]).is_a?(Array) && !tree.empty?
            lines << "Tree:"
            lines += tree.first(30)
          end
          req_files = required_files_from_config
          if req_files.any? && files.any?
            missing = req_files - files
            lines << "Missing: #{missing.join(", ")}" if missing.any?
          end
          code = data["code"]
          if st && st != "ok"
            suggestion = nil
            if code == "not_found"
              suggestion = "Suggestion: 创建 tools/#{tname} 或运行 ./bin/aura tools add #{tname}"
            elsif code == "execution_error"
              suggestion = "Suggestion: 修复逻辑或清理 __pycache__ 后重试"
            elsif code
              suggestion = "Suggestion: 根据错误码 #{code} 修复配置或权限"
            else
              suggestion = "Suggestion: 检查 manifest.json 与 logic.py 是否完整"
            end
            lines << suggestion if suggestion
          end
          lines.join("\n")
        end

        def required_files_from_config
          path = File.join(Dir.pwd, "config", "config.yml")
          begin
            data = File.exist?(path) ? YAML.load_file(path) : {}
            req = data.dig("tool_protocol", "required_files") || []
            req.is_a?(Array) ? req : []
          rescue StandardError
            []
          end
        end
      end
    end
  end
end
