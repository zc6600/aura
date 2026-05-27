# frozen_string_literal: true

module Aura
  module Context
    class Payload
      attr_reader :sections, :tools

      def initialize(sections, tools = [])
        @sections = sections || {}
        @tools = tools || []
      end

      # Backward compatibility: behaves like a string
      def to_s
        to_markdown
      end

      def to_str
        to_markdown
      end

      # Forward any string methods to the markdown representation
      def method_missing(method, ...)
        to_markdown.send(method, ...)
      end

      def respond_to_missing?(method, include_private = false)
        to_markdown.respond_to?(method, include_private)
      end

      # Render the context markdown, optionally excluding specific section keys
      def to_markdown_excluding(excluded_keys = [])
        order = %i[
          directive
          workspace
          task
          active
          index
          knowledge
          state
          env
          lsp
        ]
        order.map do |k|
          next if excluded_keys.include?(k)

          @sections[k]
        end.compact.join("\n\n")
      end

      def to_markdown
        to_markdown_excluding([])
      end

      # Convert to LLM messages format
      # @param goal [String, nil] Current user task
      # @return [Array<Hash>] Array of message hashes
      def to_messages(goal: nil)
        user_content = build_user_content(goal)
        return [] if user_content.nil? || user_content.empty?

        [{ role: "user", content: user_content }]
      end

      # Extract tool schemas for native tool calling
      # @return [Array<Hash>] Array of tool schema hashes in OpenAI format
      def to_tool_schemas
        return [] if @tools.empty?

        @tools.map do |tool|
          schema = tool[:input_schema] || {}
          # Always process schema to ensure array types have items field
          schema = process_schema(schema)
          # Normalize if missing type field
          schema = normalize_schema(schema) unless schema_valid?(schema)

          {
            type: "function",
            function: {
              name: tool[:name],
              description: tool[:description] || "",
              parameters: schema
            }
          }
        end
      end

      private

      # Build user message content from context sections
      def build_user_content(goal)
        # Exclude tool sections (:active, :index) since tools are passed separately
        parts = to_markdown_excluding(%i[active index])

        # Add goal if present
        parts = [parts, "## CURRENT USER TASK", goal.strip].compact.join("\n\n") if goal && !goal.strip.empty?

        parts
      end

      # Normalize tool schema to ensure proper structure
      def normalize_schema(schema)
        return { type: "object", properties: {}, required: [] } unless schema.is_a?(Hash)
        return process_schema(schema) if schema.key?("type") || schema.key?(:type)

        # Wrap loose properties schema
        wrapped = {
          type: "object",
          properties: schema["properties"] || schema[:properties] || {},
          required: schema["required"] || schema[:required] || []
        }
        process_schema(wrapped)
      end

      # Process schema to ensure array types have items field
      def process_schema(schema)
        return schema unless schema.is_a?(Hash)

        props = schema["properties"] || schema[:properties]
        if props.is_a?(Hash)
          props.each_value do |v|
            next unless v.is_a?(Hash)

            type = v["type"] || v[:type]
            # OpenAI requires 'items' for array types
            v["items"] = { "type" => "string" } if type.to_s == "array" && !(v.key?("items") || v.key?(:items))
          end
        end

        schema
      end

      # Check if schema is valid (has type field)
      def schema_valid?(schema)
        return false unless schema.is_a?(Hash)

        schema.key?("type") || schema.key?(:type)
      end
    end
  end
end
