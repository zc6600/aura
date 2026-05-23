# frozen_string_literal: true

require "json"
require "time"
require "date"
require "aura/kernel"
require "aura/ext/mcp/manager"
require "aura/config_loader"

module Aura
  module Context
    class ToolProvider
      attr_reader :active_tools

      def initialize(path, options = {})
        env_path = (defined?(Aura) && Aura.respond_to?(:environment_path)) ? (Aura::PathResolver.environment_path(path) || path) : path
        @project_path = env_path
        @workspace_root = path
        @options = options
        @state = options[:state]
        @current_turn = options[:current_turn] || 0
        @registry = Aura::Kernel::ToolRegistry.new(env_path)
        @manager = Aura::Context::Manager.new(env_path)
        @mcp_manager = Aura::MCP::Manager.new(env_path)
        @active_tools = []
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
        @active_tools = []
        
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

      def provide_structured
        provide if @active_tools.empty?
        @active_tools
      end

      private

      # ========================================================================
      # Context Management
      # ========================================================================

      def scan_ttl_configs
        configs = {}
        # We can use registry to find groups
        tps = [
          File.join(@workspace_root, "tools"),
          File.join(@project_path, "tools")
        ].uniq
        
        tps.each do |tools_dir|
          next unless Dir.exist?(tools_dir)
          Dir.glob(File.join(tools_dir, "*", "group_manifest.json")) do |manifest_path|
            begin
              manifest = JSON.parse(File.read(manifest_path))
              if manifest["context"] && manifest["context"]["name"]
                configs[manifest["context"]["name"]] = manifest["context"]["lifecycle"]["ttl"]
              end
            rescue JSON::ParserError, Errno::ENOENT, Errno::EACCES
              next
            end
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

          @active_tools << {
            name: name,
            description: manifest["description"] || "",
            input_schema: manifest["input_schema"] || manifest["input"] || {},
            permissions: manifest["permissions"] || {},
            hint: load_hint(dir)
          }
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

        # Treat previously verified tools as "active" so the agent can reliably discover them.
        should_auto_load = manifest["auto_load"] == true || is_core_tool?(name)
        if should_auto_load
          desc = build_full_description(name, dir, manifest)
          desc += breadcrumb unless breadcrumb.empty?
          @loaded_tools << desc

          @active_tools << {
            name: name,
            description: manifest["description"] || "",
            input_schema: manifest["input_schema"] || manifest["input"] || {},
            permissions: manifest["permissions"] || {},
            hint: load_hint(dir)
          }
        else
          rel = dir.sub(/^#{Regexp.escape(@project_path)}\//, "")
          info = "- #{name}: #{manifest["description"] || ""} (Path: #{rel})"
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
        schema = manifest["input_schema"] || manifest["input"]
        usage  = usage_from_schema(schema) || "n/a"
        
        req_context = manifest["requires_context"]
        req_line = req_context ? "Requires: #{req_context}" : nil

        lines = [
          "## #{name}",
          "Description: #{desc}",
          req_line,
          "Permissions: #{perms.to_json}",
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
      rescue JSON::ParserError, Errno::ENOENT, Errno::EACCES
        nil
      end

      def load_hint(dir)
        hint_file = Dir.glob(File.join(dir, "*.hint")).first
        if hint_file
          rel_hint_file = hint_file.sub(/^#{Regexp.escape(@project_path)}\//, "")
          if ignored?(rel_hint_file)
            return "No specific guidance provided."
          end
          content = File.read(hint_file).strip
          max_file_chars = fetch_max_file_chars
          if content.length > max_file_chars
            content = content[0, max_file_chars] + " ... [truncated]"
          end
          content
        else
          "No specific guidance provided."
        end
      rescue Errno::ENOENT, Errno::EACCES, IOError
        "No specific guidance provided."
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


      def load_config
        @config ||= Aura::ConfigLoader.load(@project_path, safe: true)
      rescue Aura::ConfigLoader::ConfigError, ArgumentError, TypeError
        {}
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
            @active_tools << {
              name: tool["name"],
              description: tool["description"] || "",
              input_schema: tool["input_schema"] || {},
              permissions: {},
              hint: tool["hint"] || "No specific guidance provided."
            }
          else
            @indexed_only << build_mcp_index(tool)
          end
        end
      rescue Timeout::Error, IOError, SystemCallError
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
          "Usage: #{usage}",
          "Hint: #{hint}"
        ].join("\n")
      end

      def build_mcp_index(tool)
        name = tool["name"]
        desc = tool["description"] || ""
        server = tool["server"] || "mcp"
        "- #{name}: #{desc} (Path: mcp://#{server})"
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
          "Usage: #{usage_from_schema(info['input_schema'])}",
          "Hint: Use this tool to get real-time feedback on code changes."
        ].join("\n")

        @active_tools << {
          name: info['name'],
          description: info['description'] || "",
          input_schema: info['input_schema'] || {},
          permissions: {},
          hint: "Use this tool to get real-time feedback on code changes."
        }
      end

      def fetch_max_file_chars
        cfg = load_config
        limit = cfg.dig("hints", "max_file_chars")
        limit ? limit.to_i : 10000
      end

      def ignored?(rel_path)
        cfg = load_config
        ignore_list = cfg.dig("hints", "ignore_list") || []
        ignore_list.any? do |pattern|
          File.fnmatch?(pattern, rel_path, File::FNM_PATHNAME | File::FNM_DOTMATCH) || 
            rel_path == pattern || 
            rel_path.include?(pattern)
        end
      end
    end
  end
end
