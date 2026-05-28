# frozen_string_literal: true

module Aura
  module Context
    class Payload
      attr_reader :prompt, :env_provider, :memory, :sections, :tools

      def initialize(prompt_or_sections, env_provider = nil, memory = nil, tools = [], options = {}, sections = {})
        if prompt_or_sections.is_a?(Hash)
          # Old signature: initialize(sections, tools = [], options = {})
          @sections = prompt_or_sections || {}
          @tools = env_provider || []
          @options = memory || {}

          @prompt = Aura::Context::Prompt.new(
            @sections[:directive],
            @sections[:workspace],
            @sections[:task]
          )
          @env_provider = Aura::Context::EnvProvider.new(
            overview: @sections[:env],
            lsp: @sections[:lsp],
            knowledge: @sections[:knowledge]
          )
          @memory = Aura::Context::Memory.new(
            state: @sections[:state]
          )
        else
          # New signature: initialize(prompt, env_provider, memory, tools = [], options = {}, sections = {})
          @prompt = prompt_or_sections
          @env_provider = env_provider
          @memory = memory
          @tools = tools || []
          @options = options || {}
          @sections = sections || {}
        end
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
        mode = @options[:directive_mode]
        if %i[ralph_developer ralph_critic].include?(mode)
          system_prompt = @prompt.kernel_prompt
          user_content = build_user_content(goal)
          [
            { role: "system", content: system_prompt },
            { role: "user", content: user_content }
          ]
        else
          user_content = build_user_content(goal)
          return [] if user_content.nil? || user_content.empty?

          [{ role: "user", content: user_content }]
        end
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
        mode = @options[:directive_mode]
        if mode == :ralph_critic
          audit = @options[:ralph_audit] || {}
          changes = audit[:changes] || ""
          previous_audit = audit[:previous_audit] || ""
          test_output = audit[:test_output] || ""
          task_content = audit[:task_content] || ""

          critic_mode = (@options[:critic_mode] || "light").to_s.downcase
          parts = critic_mode == "heavy" ? to_markdown_excluding(%i[directive active index state]) : nil

          [
            parts,
            "# INITIAL GOAL\n#{goal}",
            "# PREVIOUS CRITIC AUDIT\n#{previous_audit}",
            "# CURRENT WORKSPACE CHANGES\n#{changes}",
            "# PHYSICAL TEST EXECUTION VERIFICATION LOG\n#{test_output}",
            "# TASK CHECKLIST\n#{task_content}",
            "Please audit these changes. Are they complete and correct according to the Goal?\n" \
            "Does it address the previous critique and satisfy all acceptance criteria?"
          ].compact.join("\n\n")
        elsif mode == :ralph_developer
          parts = to_markdown_excluding(%i[directive active index state])

          recap = @options[:ralph_recap] || {}
          last_tool = recap[:last_tool] || "None"
          last_output = recap[:last_output] || "No tools executed yet."
          last_test = recap[:last_test] || "Not run yet."
          verifier_mode = recap[:verifier_mode] || "Physical Command"

          recap_text = <<~RECAP
            # LAST ITERATION RECAP
            - **Last Tool Executed**: `#{last_tool}`
            - **Last Tool Result**:
            ```
            #{last_output}
            ```

            # CURRENT VERIFICATION STATUS
            - **Verifier Mode**: #{verifier_mode}
            - **Verification Feedback**:
            ```
            #{last_test}
            ```
          RECAP

          [
            parts,
            recap_text,
            "## CURRENT USER TASK",
            goal.to_s.strip
          ].compact.join("\n\n")
        else
          # Exclude tool sections (:active, :index) since tools are passed separately
          parts = to_markdown_excluding(%i[active index])

          # Add goal if present
          parts = [parts, "## CURRENT USER TASK", goal.strip].compact.join("\n\n") if goal && !goal.strip.empty?

          parts
        end
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
