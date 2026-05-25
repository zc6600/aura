# frozen_string_literal: true

require "open3"
require "json"
require "fileutils"
require "aura"
require "aura/llm/prompts/ralph_prompt"
require "aura/llm/parsers/response_parser"
require "aura/context"
require "aura/kernel/event_bus"
require "aura/kernel/agent_loop"

module Aura
  module Kernel
    # Wraps custom payload elements (system/user messages, tool schemas)
    # to feed them directly into the standard AgentLoop and Planner.
    class RalphPayload
      attr_reader :messages, :tools
      
      def initialize(messages, tools = [])
        @messages = messages || []
        @tools = tools || []
      end
      
      def to_messages(goal: nil)
        @messages
      end
      
      def to_tool_schemas
        @tools
      end
      
      def to_s
        @messages.map { |m| "## #{m[:role].upcase}\n#{m[:content]}" }.join("\n\n")
      end
      
      def to_str
        to_s
      end
    end

    class RalphLoop
      def initialize(runner, goal, options = {})
        @runner = runner
        @project_path = File.expand_path(@runner.instance_variable_get(:@project_path))
        @env_path = File.expand_path(@runner.instance_variable_get(:@env_path))
        @goal = goal
        @options = options
        @event_bus = options[:event_bus] || NullEventBus.new
        
        # Load configuration
        @config = @runner.load_config || {}
        
        # Setup Ralph Loop parameters
        @max_steps = (@options[:max_steps] || @config.dig("ralph", "max_steps") || 100).to_i
        @verify_command = @options[:verify_command] || @config.dig("ralph", "verify_command")
        @use_critic = @options[:critic] || @config.dig("ralph", "use_critic") || false
        
        # Set up state variables for persistent prompt injection
        @last_tool_name = "None"
        @last_tool_output = "No tools executed yet."
        @last_test_feedback = "Not run yet."
        @current_mode = :developer
        
        # Define hook proc and register it cleanly
        setup_planning_hook
        @runner.hooks.register(:before_planning, &@planning_hook_proc)
      end
      
      def run
        run_id = Time.now.strftime("%Y%m%d_%H%M%S")
        step_count = 1

        # Automatically seed a checklist task.md if none exists
        task_path = File.join(@project_path, "task.md")
        unless File.exist?(task_path)
          File.write(task_path, <<~MARKDOWN, encoding: "utf-8")
            # Task Progress Checklist
            - [ ] #{@goal}
          MARKDOWN
        end
        
        @last_tool_name = "None"
        @last_tool_output = "No tools executed yet."
        @last_test_feedback = "Not run yet."
        @current_mode = :developer
        
        @event_bus.emit(:ralph_start, goal: @goal, max_steps: @max_steps, verifier: @use_critic ? "Critic LLM" : "Physical command: '#{@verify_command}'")
        
        begin
          loop do
            if step_count > @max_steps
              @event_bus.emit(:loop_aborted, reason: "Max steps limit reached (#{@max_steps})")
              return :failed
            end
            
            # 1. Stateless isolation: generate a fresh temporary session name
            session_name = "ralph_run_#{run_id}_step_#{step_count}"
            
            @event_bus.emit(:ralph_step_start, step: step_count, max_steps: @max_steps, session: session_name)
            
            # 2. Hot-swap the runner's database memory session cleanly
            @runner.reconnect_session!(session_name)
            
            # 3. Observe current project workspace state (LSP, task.md, knowledge)
            context_payload = @runner.observe
            
            # 4. Compose stateless messages
            user_directives = load_custom_ralph_system_prompt || Aura::LLM::Prompts::DEFAULT_RALPH_USER_DIRECTIVES
            system_prompt = "#{Aura::LLM::Prompts::RALPH_PROTOCOL_PROMPT}\n\n#{user_directives}"
            user_content = build_user_prompt_content(context_payload, @last_tool_name, @last_tool_output, @last_test_feedback)
            
            messages = [
              { role: "system", content: system_prompt },
              { role: "user", content: user_content }
            ]
            
            # Wrap our custom messages and tools in RalphPayload for AgentLoop compatibility
            payload = RalphPayload.new(messages, context_payload.to_tool_schemas)
            
            # 5. Execute standard Developer AgentLoop
            @current_mode = :developer
            @event_bus.emit(:thought, content: "Starting Developer AgentLoop...")
            agent_loop = AgentLoop.new(@runner, event_bus: @event_bus)
            result = agent_loop.run(@goal, ctx: payload)
            
            # Track the last executed tool for iteration recap
            if result.steps && !result.steps.empty?
              last_step = result.steps.last
              @last_tool_name = last_step[:tool] || last_step["tool"] || "None"
              @last_tool_output = format_tool_result(last_step[:result] || last_step["result"])
            else
              @last_tool_name = "None"
              @last_tool_output = "No tools executed in this turn."
            end
            
            @event_bus.emit(:thought, content: "Developer AgentLoop finished with status: #{result.status}. Running verification checks...")
            
            # 6. Run verification checks
            verification = run_verification
            
            if result.status == :completed && verification[:passed]
              final_content = result.final_content || "Task completed successfully."
              @event_bus.emit(:final_answer, content: final_content)
              return :completed
            else
              @event_bus.emit(:thought, content: "Verification failed or AgentLoop did not complete naturally. Final attempt rejected.")
              @last_test_feedback = verification[:output]
              step_count += 1
            end
          end
        ensure
          # Software Engineering Hygiene: Clean up our hook block from the runner to avoid side effects
          if @runner.hooks.instance_variable_get(:@hooks)
            @runner.hooks.instance_variable_get(:@hooks)[:before_planning]&.delete(@planning_hook_proc)
          end
        end
      end
      
      private
      
      def setup_planning_hook
        @planning_hook_proc = lambda do |payload|
          ctx = payload[:context]
          
          # Skip wrapper if it is already a custom RalphPayload
          next if ctx.is_a?(RalphPayload)
          
          # Dynamically wrap context observations with Ralph system prompts
          if @current_mode == :critic
            changes = get_git_diff_with_untracked
            previous_audit = load_previous_critique
            
            test_output = ""
            if @verify_command && !@verify_command.to_s.strip.empty?
              begin
                stdout, stderr, _ = Open3.capture3(@verify_command, chdir: @project_path)
                test_output = "### Test Execution Output (Command: '#{@verify_command}'):\nSTDOUT:\n#{stdout}\nSTDERR:\n#{stderr}"
              rescue StandardError => e
                test_output = "### Test Execution Output (Command: '#{@verify_command}'):\nError running test command: #{e.message}"
              end
            else
              test_output = "No physical verification command configured."
            end

            task_content = ""
            task_path = File.join(@project_path, "task.md")
            if File.exist?(task_path)
              task_content = "### task.md Checklist:\n```markdown\n#{File.read(task_path, encoding: "utf-8")}\n```"
            end
            
            audit_content = <<~AUDIT
              # INITIAL GOAL
              #{@goal}

              # PREVIOUS CRITIC AUDIT
              #{previous_audit}

              # CURRENT WORKSPACE CHANGES
              #{changes}

              # PHYSICAL TEST EXECUTION VERIFICATION LOG
              #{test_output}

              # TASK CHECKLIST
              #{task_content}

              Please audit these changes. Are they complete and correct according to the Goal?
              Does it address the previous critique and satisfy all acceptance criteria?
            AUDIT
            
            critic_rules = load_custom_critic_rules || Aura::LLM::Prompts::DEFAULT_CRITIC_AUDIT_RULES
            critic_system_prompt = "#{Aura::LLM::Prompts::CRITIC_PROTOCOL_PROMPT}\n\n#{critic_rules}"
            
            messages = [
              { role: "system", content: critic_system_prompt },
              { role: "user", content: audit_content }
            ]
            
            payload[:context] = RalphPayload.new(messages, [])
          else
            user_directives = load_custom_ralph_system_prompt || Aura::LLM::Prompts::DEFAULT_RALPH_USER_DIRECTIVES
            system_prompt = "#{Aura::LLM::Prompts::RALPH_PROTOCOL_PROMPT}\n\n#{user_directives}"
            user_content = build_user_prompt_content(ctx, @last_tool_name, @last_tool_output, @last_test_feedback)
            
            messages = [
              { role: "system", content: system_prompt },
              { role: "user", content: user_content }
            ]
            
            payload[:context] = RalphPayload.new(messages, ctx.respond_to?(:to_tool_schemas) ? ctx.to_tool_schemas : [])
          end
        end
      end
      
      def load_custom_ralph_system_prompt
        path = File.join(@env_path, "prompts", "ralph_system.md")
        return File.read(path, encoding: "utf-8").strip if File.exist?(path)
        nil
      end

      def load_custom_critic_rules
        path = File.join(@env_path, "prompts", "critic_rules.md")
        return File.read(path, encoding: "utf-8").strip if File.exist?(path)
        nil
      end
      
      def build_user_prompt_content(context_payload, last_tool, last_output, last_test)
        # Exclude directive (old system.md), active tools index, and state (which is empty anyway)
        parts = context_payload.to_markdown_excluding([:directive, :active, :index, :state])
        
        recap = <<~RECAP
          # LAST ITERATION RECAP
          - **Last Tool Executed**: `#{last_tool}`
          - **Last Tool Result**:
          ```
          #{last_output}
          ```

          # CURRENT VERIFICATION STATUS
          - **Verifier Mode**: #{@use_critic ? 'Critic LLM Audit' : 'Physical Command'}
          - **Verification Feedback**:
          ```
          #{last_test}
          ```
        RECAP
        
        [
          parts,
          recap,
          "## CURRENT USER TASK",
          @goal.strip
        ].compact.join("\n\n")
      end
      
      def run_verification
        if @use_critic
          run_critic_audit
        else
          run_physical_test
        end
      end
      
      def run_physical_test
        if @verify_command.nil? || @verify_command.to_s.strip.empty?
          return { passed: true, output: "No verification command configured. Auto-passed." }
        end
        
        stdout, stderr, status = Open3.capture3(@verify_command, chdir: @project_path)
        passed = status.success?
        output = "STDOUT:\n#{stdout}\nSTDERR:\n#{stderr}"
        { passed: passed, output: output }
      rescue StandardError => e
        { passed: false, output: "Error running test command: #{e.message}" }
      end
      
      def run_critic_audit
        @current_mode = :critic
        changes = get_git_diff_with_untracked
        previous_audit = load_previous_critique
        
        # Run physical test command first if present to gather compiler/test traces for Critic
        test_output = ""
        if @verify_command && !@verify_command.to_s.strip.empty?
          begin
            stdout, stderr, _ = Open3.capture3(@verify_command, chdir: @project_path)
            test_output = "### Test Execution Output (Command: '#{@verify_command}'):\nSTDOUT:\n#{stdout}\nSTDERR:\n#{stderr}"
          rescue StandardError => e
            test_output = "### Test Execution Output (Command: '#{@verify_command}'):\nError running test command: #{e.message}"
          end
        else
          test_output = "No physical verification command configured."
        end

        task_content = ""
        task_path = File.join(@project_path, "task.md")
        if File.exist?(task_path)
          task_content = "### task.md Checklist:\n```markdown\n#{File.read(task_path, encoding: "utf-8")}\n```"
        end
        
        audit_content = <<~AUDIT
          # INITIAL GOAL
          #{@goal}

          # PREVIOUS CRITIC AUDIT
          #{previous_audit}

          # CURRENT WORKSPACE CHANGES
          #{changes}

          # PHYSICAL TEST EXECUTION VERIFICATION LOG
          #{test_output}

          # TASK CHECKLIST
          #{task_content}

          Please audit these changes. Are they complete and correct according to the Goal?
          Does it address the previous critique and satisfy all acceptance criteria?
        AUDIT
        
        critic_rules = load_custom_critic_rules || Aura::LLM::Prompts::DEFAULT_CRITIC_AUDIT_RULES
        critic_system_prompt = "#{Aura::LLM::Prompts::CRITIC_PROTOCOL_PROMPT}\n\n#{critic_rules}"
        
        messages = [
          { role: "system", content: critic_system_prompt },
          { role: "user", content: audit_content }
        ]
        
        critic_payload = RalphPayload.new(messages, []) # Critic has no tools
        
        # Rotate to critic session to keep audit database amnesia separate
        critic_session = "ralph_critic_audit_#{Time.now.to_i}"
        @runner.reconnect_session!(critic_session)
        
        # Run Critic Agent via AgentLoop
        @event_bus.emit(:thought, content: "Starting Critic AgentLoop...")
        critic_loop = AgentLoop.new(@runner, event_bus: @event_bus)
        result = critic_loop.run("Audit changes", ctx: critic_payload)
        
        content = result.final_content.to_s
        parsed = Aura::LLM::Parsers::ResponseParser.safe_json_parse(content)
        
        if parsed.is_a?(Hash)
          completed = (parsed["completed"] == true || parsed[:completed] == true)
          critique = parsed["critique"] || parsed[:critique] || ""
          advice = parsed["advice"] || parsed[:advice] || ""
          
          # Persist the critique report under .aura/state/critic_audit.md
          write_critic_audit_file(critique, advice, completed)
          
          feedback = "CRITIQUE:\n#{critique}\n\nADVICE:\n#{advice}"
          { passed: completed, output: feedback }
        else
          # Fallback if Critic doesn't output valid JSON
          fallback_feedback = "Critic LLM output format error. Feedback:\n#{content}"
          write_critic_audit_file("Failed to parse JSON critique. Raw content: #{content}", "Ensure the critic outputs valid JSON.", false)
          { passed: false, output: fallback_feedback }
        end
      end
      
      def get_git_diff
        stdout, _, _ = Open3.capture3("git diff HEAD", chdir: @project_path)
        stdout.to_s
      rescue StandardError
        ""
      end

      def get_git_diff_with_untracked
        diff = get_git_diff
        
        untracked_files = []
        begin
          stdout, _, _ = Open3.capture3("git status --porcelain", chdir: @project_path)
          stdout.to_s.each_line do |line|
            if line.start_with?("?? ")
              file_path = line[3..-1].strip
              untracked_files << file_path
            end
          end
        rescue StandardError
          # Safe fallback if git is not initialized
        end
        
        untracked_content = []
        untracked_files.each do |f|
          full_path = File.join(@project_path, f)
          if File.file?(full_path)
            content = File.read(full_path, encoding: "utf-8") rescue "[Error reading file]"
            untracked_content << "### Untracked File: #{f}\n```\n#{content}\n```"
          end
        end
        
        [
          diff.empty? ? 'No tracked changes in Git.' : "### Tracked Git Diff:\n```diff\n#{diff}\n```",
          untracked_content.empty? ? nil : "### Untracked Files Content:\n#{untracked_content.join("\n\n")}"
        ].compact.join("\n\n")
      end

      def load_previous_critique
        audit_path = File.join(@env_path, "state", "critic_audit.md")
        if File.exist?(audit_path)
          File.read(audit_path, encoding: "utf-8")
        else
          "No previous critic audit exists."
        end
      end

      def write_critic_audit_file(critique, advice, passed)
        audit_path = File.join(@env_path, "state", "critic_audit.md")
        FileUtils.mkdir_p(File.dirname(audit_path))
        
        status_str = passed ? "PASSING" : "FAILING"
        content = <<~MARKDOWN
          # Critic Audit Report
          - **Status**: #{status_str}
          - **Timestamp**: #{Time.now.strftime("%Y-%m-%d %H:%M:%S")}
          
          ## Critique
          #{critique}
          
          ## Advice
          #{advice}
        MARKDOWN
        File.write(audit_path, content, encoding: "utf-8")
      end
      
      def format_tool_result(run_res)
        return "No result payload returned." unless run_res.is_a?(Hash)
        
        status = run_res["status"] || run_res[:status] || "ok"
        output = run_res["output"] || run_res[:output] || run_res["content"] || run_res[:content] || run_res.to_json
        
        "Status: #{status}\nOutput:\n#{output}"
      end
    end
  end
end
