# frozen_string_literal: true

require "json"

module Aura
  module Kernel
    class ToolRegistry
      def initialize(project_path)
        @project_path = (defined?(Aura) && Aura.respond_to?(:environment_path)) ? (Aura.environment_path(project_path) || project_path) : project_path
        @tools_path = File.join(@project_path, "tools")
        @registry = {}
        @groups = {}
        @last_scan_mtime = nil
        scan!
      end

      def find(tool_name)
        maybe_refresh!
        tool = @registry[tool_name]
        return tool if tool
        scan!
        @registry[tool_name]
      end

      def group_for(tool_name)
        @registry[tool_name]&.fetch(:group, nil)
      end

      def all_tools
        maybe_refresh!
        @registry.keys
      end

      def scan!
        return unless Dir.exist?(@tools_path)
        @registry = {}
        @groups = {}

        Dir.glob(File.join(@tools_path, "*")) do |dir|
          next unless File.directory?(dir)
          
          if File.exist?(File.join(dir, "group_manifest.json"))
            process_group(dir)
          else
            process_standalone_tool(dir)
          end
        end
        @last_scan_mtime = latest_tools_mtime
      end

      private
      
      def maybe_refresh!
        return unless Dir.exist?(@tools_path)
        current = latest_tools_mtime
        return if @last_scan_mtime && current <= @last_scan_mtime
        scan!
      end

      def latest_tools_mtime
        paths = [@tools_path]
        paths.concat(Dir.glob(File.join(@tools_path, "*", "manifest.json")))
        paths.concat(Dir.glob(File.join(@tools_path, "*", "group_manifest.json")))
        paths.concat(Dir.glob(File.join(@tools_path, "*", "*", "manifest.json")))
        paths.map { |p| File.exist?(p) ? File.mtime(p).to_i : 0 }.max || 0
      end

      def process_group(dir)
        manifest_path = File.join(dir, "group_manifest.json")
        begin
          group_manifest = JSON.parse(File.read(manifest_path))
          group_name = group_manifest["group_name"] || File.basename(dir)
          @groups[group_name] = { 
            path: dir, 
            manifest: group_manifest 
          }

          # Process entry tool
          entry_tool = group_manifest["entry_tool"]
          if entry_tool
            entry_dir = File.join(dir, entry_tool)
            register_tool(entry_dir, group: group_name)
          end

          # Process subtools
          subtools = group_manifest["subtools"] || []
          subtools.each do |subtool_name|
            subtool_dir = File.join(dir, subtool_name)
            register_tool(subtool_dir, group: group_name)
          end
        rescue StandardError => e
          # Skip invalid groups
        end
      end

      def process_standalone_tool(dir)
        register_tool(dir)
      end

      def register_tool(dir, group: nil)
        manifest_path = File.join(dir, "manifest.json")
        return unless File.exist?(manifest_path)

        begin
          manifest = JSON.parse(File.read(manifest_path))
          name = manifest["name"] || File.basename(dir)
          @registry[name] = {
            path: dir,
            manifest: manifest,
            group: group
          }
        rescue StandardError
          # Skip invalid manifests
        end
      end
    end
  end
end
