# frozen_string_literal: true

require "test_helper"
require "aura/context"

module Aura
  module Context
    class TestPayloadLLMMethods < Minitest::Test
      def test_to_messages_builds_user_message
        payload = Payload.new(
          {
            directive: "# Directive\nTest directive",
            workspace: "# Workspace\nTest workspace",
            env: "# Environment\nTest env"
          },
          []
        )

        messages = payload.to_messages(goal: "Test goal")

        assert_equal 1, messages.length
        assert_equal "user", messages[0][:role]
        assert_includes messages[0][:content], "# Directive"
        assert_includes messages[0][:content], "# Workspace"
        assert_includes messages[0][:content], "## CURRENT USER TASK"
        assert_includes messages[0][:content], "Test goal"
        # Should exclude tool sections
        refute_includes messages[0][:content], "# ACTIVE TOOLS"
      end

      def test_to_messages_without_goal
        payload = Payload.new(
          { directive: "# Directive" },
          []
        )

        messages = payload.to_messages

        assert_equal 1, messages.length
        assert_includes messages[0][:content], "# Directive"
        refute_includes messages[0][:content], "## CURRENT USER TASK"
      end

      def test_to_tool_schemas_formats_correctly
        tools = [
          {
            name: "read_file",
            description: "Read file contents",
            input_schema: {
              type: "object",
              properties: {
                path: { type: "string" }
              },
              required: ["path"]
            }
          }
        ]

        payload = Payload.new({}, tools)
        schemas = payload.to_tool_schemas

        assert_equal 1, schemas.length
        assert_equal "function", schemas[0][:type]
        assert_equal "read_file", schemas[0][:function][:name]
        assert_equal "Read file contents", schemas[0][:function][:description]
        assert schemas[0][:function][:parameters].is_a?(Hash)
      end

      def test_to_tool_schemas_normalizes_schema
        tools = [
          {
            name: "write_file",
            description: "Write to file",
            input_schema: {
              properties: {
                path: { type: "string" },
                content: { type: "string" }
              },
              required: ["path"]
            }
          }
        ]

        payload = Payload.new({}, tools)
        schemas = payload.to_tool_schemas

        assert_equal 1, schemas.length
        params = schemas[0][:function][:parameters]
        assert_equal "object", params[:type]
        assert params.key?(:properties)
        assert params.key?(:required)
      end

      def test_to_tool_schemas_empty_tools
        payload = Payload.new({}, [])
        schemas = payload.to_tool_schemas

        assert_equal [], schemas
      end

      def test_to_messages_excludes_tool_sections
        payload = Payload.new(
          {
            directive: "# Directive",
            active: "# ACTIVE TOOLS\nTool list",
            index: "# TOOL INDEX\nIndex list"
          },
          []
        )

        messages = payload.to_messages
        content = messages[0][:content]

        assert_includes content, "# Directive"
        refute_includes content, "# ACTIVE TOOLS"
        refute_includes content, "# TOOL INDEX"
      end

      def test_to_markdown_still_works
        payload = Payload.new(
          {
            directive: "# Directive",
            workspace: "# Workspace",
            task: "# Task"
          },
          []
        )

        md = payload.to_markdown
        assert_includes md, "# Directive"
        assert_includes md, "# Workspace"
        assert_includes md, "# Task"
      end

      def test_to_tool_schemas_handles_array_type
        # OpenAI API requires 'items' field for array types
        tools = [
          {
            name: "read_file",
            description: "Read a file",
            input_schema: {
              type: "object",
              properties: {
                file_path: { type: "string" },
                context_permissions: {
                  type: "array",
                  description: "Allowed path prefixes"
                  # Note: no 'items' field - should be auto-added
                }
              },
              required: ["file_path"]
            }
          }
        ]

        payload = Payload.new({}, tools)
        schemas = payload.to_tool_schemas

        assert_equal 1, schemas.length
        props = schemas[0][:function][:parameters][:properties]
        
        # Verify array type has items field added
        array_prop = props[:context_permissions] || props["context_permissions"]
        assert_equal "array", array_prop[:type] || array_prop["type"]
        assert array_prop.key?(:items) || array_prop.key?("items"), "Array type must have items field for OpenAI API"
        items = array_prop[:items] || array_prop["items"]
        assert_equal({ "type" => "string" }, items)
      end
    end
  end
end
