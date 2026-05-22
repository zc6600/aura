# frozen_string_literal: true

require "thor"
require "yaml"
require "json"
require "open3"

module Aura
  module Commands
    class ToolsCommand < Thor
      map "inspect" => :tool_inspect

      desc "inspect NAME", "Inspect a tool by name and print structured metadata"
      method_option :pretty, type: :boolean, aliases: "-p", default: false, desc: "Pretty-print JSON output"
      method_option :human,  type: :boolean, aliases: "-H", default: false, desc: "Human-readable summary"

        def tool_inspect(name)
          py = runtime_python
          env_path = (defined?(Aura) && Aura.respond_to?(:environment_path)) ? (Aura::PathResolver.environment_path(Dir.pwd) || Dir.pwd) : Dir.pwd
          logic = File.join(env_path, "tools", "inspect_tool", "logic.py")
          unless File.exist?(logic)
            puts "inspect_tool not found under #{logic}"
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

      desc "add TOOL_NAME_OR_URL", "Install a library tool by name, or from a Git URL/local directory"
      def add(tool_name_or_url)
        if tool_name_or_url.start_with?("http://", "https://", "git@") || File.directory?(tool_name_or_url)
          install(tool_name_or_url)
        else
          require "aura/generators/tools_generator"
          Aura::Generators::ToolsGenerator.start([tool_name_or_url])
        end
      end

      desc "install URL_OR_PATH [NAME]", "Install a tool from a Git URL or local directory"
      def install(url_or_path, name = nil)
        project_path = "."
        resolved_path = File.expand_path(project_path)

        require "securerandom"
        require "fileutils"
        require "open3"
        require "json"

        tmp_base = File.join(resolved_path, ".aura", "tmp")
        FileUtils.mkdir_p(tmp_base)
        tmp_dir = File.join(tmp_base, "tool_install_#{SecureRandom.hex(8)}")

        is_git = url_or_path.start_with?("http://", "https://", "git@")

        begin
          if is_git
            puts "Cloning repository: #{url_or_path}..."
            out, err, status = Open3.capture3("git", "clone", "--depth", "1", url_or_path, tmp_dir)
            unless status.success?
              puts "\e[31m⛔️ Error: Failed to clone repository: #{err}\e[0m"
              exit 1
            end
            src_dir = tmp_dir
          else
            src_dir = File.expand_path(url_or_path)
            unless File.directory?(src_dir)
              puts "\e[31m⛔️ Error: Local path '#{url_or_path}' is not a directory.\e[0m"
              exit 1
            end
          end

          # Find manifest.json
          manifest_path = File.join(src_dir, "manifest.json")
          unless File.exist?(manifest_path)
            # Try to find a subfolder containing manifest.json
            sub_manifests = Dir.glob(File.join(src_dir, "**/manifest.json"))
            if sub_manifests.any?
              manifest_path = sub_manifests.first
              src_dir = File.dirname(manifest_path)
            else
              puts "\e[31m⛔️ Error: No manifest.json file found in the source directory.\e[0m"
              exit 1
            end
          end

          # Determine tool name
          tool_name = name
          if tool_name.nil? || tool_name.to_s.strip.empty?
            begin
              manifest_data = JSON.parse(File.read(manifest_path))
              tool_name = manifest_data["name"]
            rescue StandardError
            end
            tool_name = File.basename(src_dir).downcase.gsub(/[^a-z0-9_\-]/, "") if tool_name.nil? || tool_name.empty?
          end

          dest_dir = File.join(resolved_path, "tools", tool_name)
          if File.exist?(dest_dir)
            puts "⛔️ Error: Tool '#{tool_name}' already exists at: #{dest_dir}"
            exit 1
          end

          FileUtils.mkdir_p(File.dirname(dest_dir))
          FileUtils.cp_r(src_dir, dest_dir)
          FileUtils.rm_rf(File.join(dest_dir, ".git"))

          puts "\e[32m✓ Tool '#{tool_name}' successfully installed to: #{dest_dir}\e[0m"
        ensure
          FileUtils.rm_rf(tmp_dir) if File.exist?(tmp_dir)
        end
      end

      no_commands do
        def runtime_python
          env_path = (defined?(Aura) && Aura.respond_to?(:environment_path)) ? (Aura::PathResolver.environment_path(Dir.pwd) || Dir.pwd) : Dir.pwd
          path = File.join(env_path, "config", "config.yml")
          begin
            data = File.exist?(path) ? YAML.load_file(path) : {}
            resolved = data.dig("tool_protocol", "runtimes", "python") || "python"
            # Normalize python3 -> python (consistent with tool_validator.rb)
            resolved = "python" if resolved == "python3"
            resolved
          rescue StandardError
            "python"
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
          env_path = (defined?(Aura) && Aura.respond_to?(:environment_path)) ? (Aura::PathResolver.environment_path(Dir.pwd) || Dir.pwd) : Dir.pwd
          path = File.join(env_path, "config", "config.yml")
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
