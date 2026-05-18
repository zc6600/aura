# frozen_string_literal: true

require "thor/group"
require "json"

module Aura
  module Generators
    class ToolGroupGenerator < Thor::Group
      include Thor::Actions

      argument :name, type: :string
      argument :subtools, type: :array, default: []

      def self.source_root
        File.expand_path("templates", __dir__)
      end

      def create_root_dir
        empty_directory("tools/#{name}")
      end

      def create_group_manifest
        manifest = {
          "group_name" => name,
          "description" => "#{name.capitalize} tool group",
          "entry_tool" => "open",
          "context" => {
            "name" => "#{name}_session",
            "multi_instance" => true,
            "lifecycle" => {
              "created_by" => "open",
              "destroyed_by" => ["close"],
              "ttl" => {
                "turns" => 20,
                "seconds" => 600,
                "policy" => "any"
              }
            }
          },
          "subtools" => ["close"] + subtools
        }
        create_file "tools/#{name}/group_manifest.json", JSON.pretty_generate(manifest)
      end

      def create_entry_tool
        create_tool("#{name}/open", {
          "name" => "#{name}_open",
          "creates_context" => "#{name}_session"
        })
      end

      def create_close_tool
        create_tool("#{name}/close", {
          "name" => "#{name}_close",
          "requires_context" => "#{name}_session",
          "destroys_context" => true
        })
      end

      def create_subtools
        subtools.each do |st|
          create_tool("#{name}/#{st}", {
            "name" => "#{name}_#{st}",
            "requires_context" => "#{name}_session"
          })
        end
      end

      private

      def create_tool(path, manifest_overrides)
        dir = "tools/#{path}"
        empty_directory(dir)
        
        manifest = {
          "name" => manifest_overrides["name"],
          "description" => "Description for #{manifest_overrides["name"]}",
          "runtime" => "python3",
          "entry" => "logic.py",
          "test" => "test.py",
          "auto_load" => manifest_overrides["creates_context"] ? true : false,
          "input_schema" => {
            "type" => "object",
            "properties" => {
              "context_id" => { "type" => "string" }
            },
            "required" => manifest_overrides["requires_context"] ? ["context_id"] : []
          }
        }.merge(manifest_overrides)

        create_file "#{dir}/manifest.json", JSON.pretty_generate(manifest)
        create_file "#{dir}/logic.py", "#!/usr/bin/env python3\nimport sys, json\n\nargs = json.loads(sys.argv[1])\nprint(json.dumps({'success': True}))\n"
        create_file "#{dir}/test.py", "#!/usr/bin/env python3\nprint('Test passed')\n"
        chmod "#{dir}/logic.py", 0755
        chmod "#{dir}/test.py", 0755
      end
    end
  end
end
