# frozen_string_literal: true

require "json"
require "time"
require "date"
require "aura/kernel"
require "aura/ext/mcp/manager"

module Aura
  module Context
    class ToolProvider
      def initialize(path, options = {})
        @project_path = path
        @options = options
        @state = options[:state]
        @current_turn = options[:current_turn] || 0
        @registry = Aura::Kernel::ToolRegistry.new(path)
        @manager = Aura::Context::Manager.new(path)
        @mcp_manager = Aura::MCP::Manager.new(path)
      end

      def provide
        # Scan for TTL configs from registry
        ttl_configs = {}
        @registry.all_tools.each do |name|
          t = @registry.find(name)
          if t[:group] && !ttl_configs.key?(t[:group])
            # Load group manifest via registry if needed, or scan once
          end
        end
        # Simpler: scan TTL configs once
        ttl_configs = scan_ttl_configs

        @active_contexts = @manager.maintenance(@current_turn, ttl_configs)

        @loaded_tools = []
        @indexed_only = []
        
        @registry.all_tools.each do |name|
          tool_data = @registry.find(name)
          manifest = tool_data[:manifest]
          dir = tool_data[:path]

          if manifest["requires_context"]
            process_subtool(name, dir, manifest)
          else
            process_top_level_tool(name, dir, manifest)
          end
        end

        append_mcp_tools
        append_lsp_tools

        [
          "# ACTIVE TOOLS (Ready to use)",
          @loaded_tools.join("\n\n"),
          "# TOOL INDEX (Use 'inspect_tool' to see details)",
          @indexed_only.join("\n")
        ].join("\n\n")
      end

      private

      # ========================================================================
      # Context Management
      # ========================================================================

      def scan_ttl_configs
        configs = {}
        # We can use registry to find groups
        tools_dir = File.join(@project_path, "tools")
        Dir.glob(File.join(tools_dir, "*", "group_manifest.json")) do |manifest_path|
          begin
            manifest = JSON.parse(File.read(manifest_path))
            if manifest["context"] && manifest["context"]["name"]
              configs[manifest["context"]["name"]] = manifest["context"]["lifecycle"]["ttl"]
            end
          rescue StandardError
            next
          end
        end
        configs
      end

      # ========================================================================
      # Tool Processing
      # ========================================================================

      def process_subtool(name, dir, manifest)
        req_context = manifest["requires_context"]
        active_instances = @active_contexts.select { |_, ctx| ctx["type"] == req_context }
        
        if active_instances.any?
          desc = build_full_description(name, dir, manifest)
          instance_ids = active_instances.keys.join(", ")
          desc = desc.gsub(/Requires: #{req_context}/, "Requires: #{req_context} (Active instances: #{instance_ids})")
          @loaded_tools << desc
        else
          # Even if context is not active, the LLM should know the tool exists
          rel = dir.sub(/^#{Regexp.escape(@project_path)}\//, "")
          @indexed_only << "- #{name}: #{manifest["description"] || ""} [LOCKED: Requires #{req_context}] (Path: #{rel})"
        end
      end

      def process_top_level_tool(name, dir, manifest)
        if name == "anchor_submit" && !anchors_has_files?
          return
        end
        # If it's an entry tool, add info about subtools it unlocks
        breadcrumb = ""
        if manifest["creates_context"]
          subtools = find_subtools_for_context(manifest["creates_context"])
          if subtools.any?
            breadcrumb = "\nUnlocks subtools: #{subtools.join(', ')}"
          end
        end

        if manifest["auto_load"] == true || is_core_tool?(name)
          desc = build_full_description(name, dir, manifest)
          desc += breadcrumb unless breadcrumb.empty?
          @loaded_tools << desc
        else
          status = tool_status(name, dir)
          rel = dir.sub(/^#{Regexp.escape(@project_path)}\//, "")
          info = "- #{name}: #{manifest["description"] || ""} #{status} (Path: #{rel})"
          info += " (Unlocks: #{subtools.join(', ')})" if manifest["creates_context"] && subtools&.any?
          @indexed_only << info
        end
      end

      def find_subtools_for_context(context_type)
        @registry.all_tools.select do |tname|
          t = @registry.find(tname)
          t[:manifest]["requires_context"] == context_type
        end
      end

      def build_full_description(name, dir, manifest)
        hint = load_hint(dir)
        desc = manifest["description"] || ""
        perms = manifest["permissions"] || {}
        status = tool_status(name, dir)
        schema = manifest["input_schema"] || manifest["input"]
        usage  = usage_from_schema(schema) || "n/a"
        
        req_context = manifest["requires_context"]
        req_line = req_context ? "Requires: #{req_context}" : nil

        lines = [
          "## #{name}",
          "Description: #{desc}",
          req_line,
          "Permissions: #{perms.to_json}",
          "Status: #{status}",
          "Usage: #{usage}",
          "Hint: #{hint}"
        ].compact
        
        lines.join("\n")
      end

      # ========================================================================
      # Helpers
      # ========================================================================

      def load_json(path)
        return nil unless File.exist?(path)
        JSON.parse(File.read(path))
      rescue StandardError
        nil
      end

      def load_hint(dir)
        hint_file = Dir.glob(File.join(dir, "*.hint")).first
        hint_file ? File.read(hint_file) : "No specific guidance provided."
      end

      def usage_from_schema(schema)
        return nil unless schema.is_a?(Hash)
        props = schema["properties"] || {}
        required = schema["required"] || []
        sample = {}
        props.each do |k, v|
          case v["type"]
          when "string" then sample[k] = "string"
          when "number", "integer" then sample[k] = 0
          when "boolean" then sample[k] = false
          when "object" then sample[k] = {}
          when "array" then sample[k] = []
          else sample[k] = nil
          end
        end
        { input: sample, required: required }.to_json
      end

      def tool_status(name, dir)
        cfg = load_config
        manifest = load_json(File.join(dir, "manifest.json")) || {}
        required = (cfg.dig("tool_protocol", "required_files") || [])
        test_file = manifest["test"] || "test.py"
        skip_test = manifest["skip_test"] == true || (manifest.dig("verification", "require_test") == false)
        req = required.reject { |f| skip_test && (f == test_file || f == "test.py") }
        present = req.select { |f| File.exist?(File.join(dir, f)) }
        missing = req - present
        
        if missing.any?
          status_msg = "[DISABLED] missing: #{missing.join(', ')}"
          status_msg += " (Found: #{present.join(', ')})" if present.any?
          return status_msg
        end
        
        if @state
          vars = @state.get_active_variables
          status = vars["tool_status:#{name}"]
          if status == "ready"
            return skip_test ? "[ACTIVE] (developer_no_test)" : "[ACTIVE]"
          elsif status == "failed"
            error = vars["tool_error:#{name}"]
            return "[FAILED] #{error}"
          end
        end
        skip_test ? "[DEVELOPER] no-test" : "[UNVERIFIED]"
      end

      def load_config
        @config ||= begin
          path = File.join(@project_path, "config", "config.yml")
          if File.exist?(path)
            require "yaml"
            YAML.load_file(path)
          else
            {}
          end
        rescue StandardError
          {}
        end
      end

      def is_core_tool?(name)
        cfg = load_config
        core = cfg.dig("tool_protocol", "core_tools")
        core ||= ["read_file", "inspect_tool", "write_file"]
        core.include?(name)
      end

      def anchors_has_files?
        dir = File.join(@project_path, "anchors")
        return false unless Dir.exist?(dir)
        config_exts = [".yaml", ".yml", ".json"]
        Dir.glob(File.join(dir, "*"))
          .any? { |f| File.file?(f) && config_exts.include?(File.extname(f).downcase) }
      end

      def append_mcp_tools
        tools = @mcp_manager.list_tools
        tools.each do |tool|
          if tool["auto_load"]
            @loaded_tools << build_mcp_description(tool)
          else
            @indexed_only << build_mcp_index(tool)
          end
        end
      rescue StandardError
        nil
      end

      def build_mcp_description(tool)
        name = tool["name"]
        desc = tool["description"] || ""
        schema = tool["input_schema"] || {}
        usage = usage_from_schema(schema) || "n/a"
        hint = tool["hint"]
        hint = nil if hint.to_s.strip.empty?
        hint ||= "No specific guidance provided."
        [
          "## #{name}",
          "Description: #{desc}",
          "Permissions: {}",
          "Status: [ACTIVE]",
          "Usage: #{usage}",
          "Hint: #{hint}"
        ].join("\n")
      end

      def build_mcp_index(tool)
        name = tool["name"]
        desc = tool["description"] || ""
        server = tool["server"] || "mcp"
        "- #{name}: #{desc} [ACTIVE] (Path: mcp://#{server})"
      end
      def append_lsp_tools
        require "aura/kernel/tools/lsp_diagnostics"
        # We don't have the manager here yet, so we just build the generic description
        # The tool will handle the manager later in ExecutionEngine.
        tool = Aura::Kernel::Tools::LSPDiagnostics.new(nil)
        info = tool.info
        @loaded_tools << [
          "## #{info['name']}",
          "Description: #{info['description']}",
          "Permissions: {}",
          "Status: [ACTIVE]",
          "Usage: #{usage_from_schema(info['input_schema'])}",
          "Hint: Use this tool to get real-time feedback on code changes."
        ].join("\n")
      end
    end
  end
end
