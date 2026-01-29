# frozen_string_literal: true

require "json"

module Aura
  module Context
    class ToolProvider
      def initialize(path)
        @tools_path = File.join(path, "tools")
        @project_path = path
      end

      def provide
        return nil unless Dir.exist?(@tools_path)
        @loaded_tools = []
        @indexed_only = []
        Dir.glob(File.join(@tools_path, "*")) do |dir|
          next unless File.directory?(dir)
          process_tool(dir)
        end
        [
          "# ACTIVE TOOLS (Ready to use)",
          @loaded_tools.join("\n\n"),
          "# TOOL INDEX (Use 'inspect_tool' to see details)",
          @indexed_only.join("\n")
        ].join("\n\n")
      end

      private

      def process_tool(dir)
        manifest_path = File.join(dir, "manifest.json")
        manifest = {}
        if File.exist?(manifest_path)
          begin
            manifest = JSON.parse(File.read(manifest_path))
          rescue StandardError
            manifest = {}
          end
        end
        name = manifest["name"] || File.basename(dir)
        if manifest["auto_load"] == true || is_core_tool?(name)
          @loaded_tools << build_full_description(dir, manifest)
        else
          @indexed_only << "- #{name}: #{manifest["description"] || ""}"
        end
      end

      def build_full_description(dir, manifest)
        hint = load_hint(dir)
        name = manifest["name"] || File.basename(dir)
        desc = manifest["description"] || ""
        perms = manifest["permissions"] || {}
        status = tool_status(dir)
        usage  = usage_from_schema(manifest["input_schema"]) || "n/a"
        [
          "## #{name}",
          "Description: #{desc}",
          "Permissions: #{perms.to_json}",
          "Status: #{status}",
          "Usage: #{usage}",
          "Hint: #{hint}"
        ].join("\n")
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

      def tool_status(dir)
        cfg = load_config
        required = (cfg.dig("tool_protocol", "required_files") || [])
        missing = required.reject { |f| File.exist?(File.join(dir, f)) }
        return "[DISABLED] missing: #{missing.join(', ')}" unless missing.empty?
        "[UNVERIFIED]"
      end

      def load_config
        begin
          require "yaml"
          path = File.join(@project_path, "config", "config.yml")
          File.exist?(path) ? YAML.load_file(path) : {}
        rescue StandardError
          {}
        end
      end

      def is_core_tool?(name)
        cfg = load_config
        core = cfg.dig("tool_protocol", "core_tools")
        core ||= ["read_file", "inspect_tool", "ls", "write_file"]
        core.include?(name)
      end
    end
  end
end
