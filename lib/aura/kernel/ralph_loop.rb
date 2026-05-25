# frozen_string_literal: true

require "open3"
require "json"
require "fileutils"
require "timeout"
require "securerandom"
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
      class FilteredEventBus
        def initialize(delegate, suppressed_events)
          @delegate = delegate
          @suppressed_events = Array(suppressed_events).map(&:to_sym)
        end

        def emit(event, **payload)
          return if @suppressed_events.include?(event.to_sym)

          @delegate.emit(event, **payload)
        end
      end

      DEFAULT_MAX_STEPS = 100
      DEFAULT_TIMEOUT = 45 # 45 seconds timeout for physical tests
      MAX_UNTRACKED_FILES = 15
      MAX_FILE_SIZE_BYTES = 20_480 # 20KB

      def initialize(runner, goal, options = {})
        @runner = runner
        @project_path = File.expand_path(@runner.project_path)
        @env_path = File.expand_path(@runner.env_path)
        @goal = goal
        @options = options
        @event_bus = options[:event_bus].nil? ? NullEventBus.new : options[:event_bus]
        # Suppress loop_aborted from propagating from inner loop to prevent outer termination confusion
        @inner_event_bus = FilteredEventBus.new(@event_bus, %i[final_answer loop_aborted])

        # Load configuration
        @config = @runner.load_config || {}

        # Setup Ralph Loop parameters
        @max_steps = (@options[:max_steps] || @config.dig("ralph", "max_steps") || DEFAULT_MAX_STEPS).to_i
        @verify_command = @options[:verify_command] || @config.dig("ralph", "verify_command")
        @use_critic = @options[:critic] || @config.dig("ralph", "use_critic") || false

        # Set up state variables for persistent prompt injection
        reset_state_variables

        # Define hook proc and register it cleanly
        setup_planning_hook
        @runner.hooks.register(:before_planning, &@planning_hook_proc)
      end

      def run
        @run_id = "#{Time.now.strftime('%Y%m%d_%H%M%S')}_#{SecureRandom.hex(4)}"
        @iteration_count = 1
        starting_session = ENV["AURA_SESSION_NAME"] || "default"
        @temp_sessions = []

        # Automatically seed a checklist task.md if none exists
        task_path = File.join(@project_path, "task.md")
        unless File.exist?(task_path)
          begin
            File.write(task_path, <<~MARKDOWN, encoding: "utf-8")
              # Task Progress Checklist
              - [ ] #{@goal}
            MARKDOWN
          rescue StandardError => e
            @event_bus.emit(:warning, message: "Failed to create task.md checklist: #{e.message}")
          end
        end

        reset_state_variables

        @event_bus.emit(:ralph_start, goal: @goal, max_steps: @max_steps,
                                      verifier: @use_critic ? "Critic LLM" : "Physical command: '#{@verify_command}'")

        begin
          loop do
            if @iteration_count > @max_steps
              @event_bus.emit(:loop_aborted, reason: "Max steps limit reached (#{@max_steps})")
              return :failed
            end

            # Reset current mode to developer at the start of each iteration
            @current_mode = :developer

            # 1. Stateless isolation: generate a fresh temporary session name
            session_name = "ralph_run_#{@run_id}_step_#{@iteration_count}"
            @temp_sessions << session_name

            @event_bus.emit(:ralph_step_start, step: @iteration_count, max_steps: @max_steps, session: session_name)

            # 2. Hot-swap the runner's database memory session cleanly
            @runner.reconnect_session!(session_name)

            # 3. Execute standard Developer AgentLoop
            @event_bus.emit(:thought, content: "Starting Developer AgentLoop (Iteration #{@iteration_count}/#{@max_steps})...")
            agent_loop = AgentLoop.new(@runner, event_bus: @inner_event_bus)

            result = begin
              agent_loop.run(@goal, ctx: nil)
            rescue StandardError => e
              @event_bus.emit(:thought, content: "Developer AgentLoop raised an exception: #{e.message}")
              # Resilient fallback: capture loop failure rather than crashing out
              AgentLoop::Result.new(
                status: :failed,
                final_content: nil,
                steps: [],
                failure_reason: "Developer loop crashed: #{e.message}"
              )
            end

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

            # 4. Run verification checks (which caches outputs to avoid double execution)
            verification = run_verification

            if result.status == :completed && verification[:passed]
              final_content = result.final_content || "Task completed successfully."
              @event_bus.emit(:final_answer, content: final_content)
              return :completed
            else
              reason = result.status != :completed ? "AgentLoop did not complete naturally (#{result.status}: #{result.failure_reason || 'unknown'})" : "Verification check failed."
              @event_bus.emit(:thought, content: "#{reason} Final attempt rejected.")
              @last_test_feedback = verification[:output]
              @iteration_count += 1
            end
          end
        rescue StandardError => e
          @event_bus.emit(:thought, content: "Ralph Loop encountered a fatal error: #{e.message}")
          :failed
        ensure
          # Restore the starting session database
          begin
            @runner.reconnect_session!(starting_session)
          rescue StandardError => e
            @event_bus.emit(:warning, message: "Error reconnecting starting session: #{e.message}")
          end

          # Clean up temporary database files
          clean_temporary_session_files

          # Software Engineering Hygiene: Clean up our hook block from the runner to avoid side effects
          @runner.hooks.unregister(:before_planning, @planning_hook_proc)
        end
      end

      private

      def reset_state_variables
        @last_tool_name = "None"
        @last_tool_output = "No tools executed yet."
        @last_test_feedback = "Not run yet."
        @current_mode = :developer
      end

      def clean_temporary_session_files
        @temp_sessions.each do |session_name|
          db_path = Aura::PathResolver.session_db_path(@project_path, session_name)
          File.delete(db_path) if File.exist?(db_path)
          # Also clean SQLite sidecars
          ["-journal", "-wal", "-shm"].each do |suffix|
            sidecar = "#{db_path}#{suffix}"
            File.delete(sidecar) if File.exist?(sidecar)
          end
        rescue StandardError => e
          @event_bus.emit(:warning, message: "Error deleting temporary session files for #{session_name}: #{e.message}")
        end
      end

      def build_audit_content(changes, previous_audit, test_output)
        task_content = ""
        task_path = File.join(@project_path, "task.md")
        if File.exist?(task_path)
          begin
            task_content = "### task.md Checklist:\n```markdown\n#{File.read(task_path, encoding: 'utf-8')}\n```"
          rescue StandardError
            task_content = "### task.md Checklist:\n[Error reading task.md]"
          end
        end

        <<~AUDIT
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
      end

      def setup_planning_hook
        @planning_hook_proc = lambda do |payload|
          ctx = payload[:context]

          # Skip wrapper if it is already a custom RalphPayload
          next if ctx.is_a?(RalphPayload)

          # Dynamically wrap context observations with Ralph system prompts
          if @current_mode == :critic
            # Critical optimization: In critic mode, the physical tests and git diff have
            # ALREADY been run and cached. We do NOT run them again!
            changes = get_git_diff_with_untracked
            previous_audit = load_previous_critique

            test_output = if @verify_command && !@verify_command.to_s.strip.empty?
                            "### Test Execution Output (Command: '#{@verify_command}'):\n#{@last_test_feedback}"
                          else
                            "No physical verification command configured."
                          end

            audit_content = build_audit_content(changes, previous_audit, test_output)

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
        parts = if context_payload.nil?
                  "No workspace context payload."
                else
                  # Exclude directive (old system.md), active tools index, and state (which is empty anyway)
                  if context_payload.respond_to?(:to_markdown_excluding)
                    context_payload.to_markdown_excluding(%i[directive active index state])
                  else
                    context_payload.to_s
                  end
                end

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

        timeout_sec = @options[:timeout]
        timeout_sec = @config.dig("ralph", "timeout") if timeout_sec.nil?
        timeout_sec = DEFAULT_TIMEOUT if timeout_sec.nil?
        timeout_sec = timeout_sec.to_f

        begin
          stdout, stderr, status = nil
          Timeout.timeout(timeout_sec) do
            # Secure execution: execute explicitly via shell using Array syntax to prevent command injection
            stdout, stderr, status = Open3.capture3("sh", "-c", @verify_command, chdir: @project_path)
          end
          passed = status.success?
          output = "STDOUT:\n#{stdout}\nSTDERR:\n#{stderr}"
          { passed: passed, output: output }
        rescue Timeout::Error
          { passed: false, output: "Verification command timed out after #{timeout_sec} seconds." }
        rescue StandardError => e
          { passed: false, output: "Error running test command: #{e.message}" }
        end
      end

      def run_critic_audit
        # Wrap entire method body in ensure to guarantee @current_mode resets back to developer
        @current_mode = :critic

        begin
          # 1. Run physical test command first if present to gather compiler/test traces for Critic
          test_res = run_physical_test
          @last_test_feedback = test_res[:output]

          changes = get_git_diff_with_untracked
          previous_audit = load_previous_critique

          test_output = if @verify_command && !@verify_command.to_s.strip.empty?
                          "### Test Execution Output (Command: '#{@verify_command}'):\n#{@last_test_feedback}"
                        else
                          "No physical verification command configured."
                        end

          audit_content = build_audit_content(changes, previous_audit, test_output)

          critic_rules = load_custom_critic_rules || Aura::LLM::Prompts::DEFAULT_CRITIC_AUDIT_RULES
          critic_system_prompt = "#{Aura::LLM::Prompts::CRITIC_PROTOCOL_PROMPT}\n\n#{critic_rules}"

          messages = [
            { role: "system", content: critic_system_prompt },
            { role: "user", content: audit_content }
          ]

          critic_payload = RalphPayload.new(messages, []) # Critic has no tools

          # Rotate to critic session to keep audit database amnesia separate
          critic_session = "ralph_critic_audit_#{@run_id}_step_#{@iteration_count}"
          @temp_sessions << critic_session
          @runner.reconnect_session!(critic_session)

          # Run Critic Agent via AgentLoop
          @event_bus.emit(:thought, content: "Starting Critic AgentLoop...")
          critic_loop = AgentLoop.new(@runner, event_bus: @inner_event_bus)

          result = begin
            critic_loop.run("Audit changes", ctx: critic_payload)
          rescue StandardError => e
            @event_bus.emit(:thought, content: "Critic AgentLoop raised an exception: #{e.message}")
            return { passed: false, output: "Critic LLM loop execution error: #{e.message}" }
          end

          content = result.final_content.to_s
          parsed = Aura::LLM::Parsers::ResponseParser.safe_json_parse(content)

          if parsed.is_a?(Hash)
            completed = parsed["completed"] == true || parsed[:completed] == true
            critique = parsed["critique"] || parsed[:critique] || ""
            advice = parsed["advice"] || parsed[:advice] || ""

            # Persist the critique report under unique critic_audit_#{run_id}_step_#{iteration_count}.md file
            write_critic_audit_file(critique, advice, completed)

            feedback = "CRITIQUE:\n#{critique}\n\nADVICE:\n#{advice}"
            { passed: completed, output: feedback }
          else
            # Fallback if Critic doesn't output valid JSON
            fallback_feedback = "Critic LLM output format error. Feedback:\n#{content}"
            write_critic_audit_file("Failed to parse JSON critique. Raw content: #{content}", "Ensure the critic outputs valid JSON.", false)
            { passed: false, output: fallback_feedback }
          end
        rescue StandardError => e
          @event_bus.emit(:thought, content: "Critic audit failed: #{e.message}")
          { passed: false, output: "Critic audit error: #{e.message}" }
        ensure
          @current_mode = :developer
        end
      end

      def get_git_diff
        stdout, = Open3.capture3("git", "diff", "HEAD", chdir: @project_path)
        stdout.to_s
      rescue StandardError => e
        @event_bus.emit(:warning, message: "Git diff failed: #{e.message}")
        ""
      end

      def get_git_diff_with_untracked
        diff = get_git_diff

        untracked_files = []
        begin
          stdout, stderr, status = Open3.capture3("git", "status", "--porcelain", chdir: @project_path)
          if status.success?
            stdout.to_s.each_line do |line|
              if line.start_with?("?? ")
                file_path = line[3..].strip
                untracked_files << file_path
              end
            end
          else
            @event_bus.emit(:warning, message: "Git status failed: #{stderr}")
          end
        rescue StandardError => e
          @event_bus.emit(:warning, message: "Git command error: #{e.message}")
        end

        untracked_content = []
        # Cap untracked files count at MAX_UNTRACKED_FILES to prevent context bloating
        untracked_files.take(MAX_UNTRACKED_FILES).each do |f|
          full_path = File.join(@project_path, f)
          next unless File.file?(full_path)
          # Skip files larger than MAX_FILE_SIZE_BYTES to protect memory and context window
          next if File.size(full_path) > MAX_FILE_SIZE_BYTES

          begin
            content = File.read(full_path, encoding: "utf-8")
            # Heuristic to skip binary files
            untracked_content << if content.include?("\x00")
                                   "### Untracked File: #{f}\n[Skipped: Binary file detected]"
                                 else
                                   "### Untracked File: #{f}\n```\n#{content}\n```"
                                 end
          rescue StandardError => e
            untracked_content << "### Untracked File: #{f}\n[Error reading file: #{e.message}]"
          end
        end

        if untracked_files.size > MAX_UNTRACKED_FILES
          untracked_content << "### [Truncated: #{untracked_files.size - MAX_UNTRACKED_FILES} additional untracked files present but skipped]"
        end

        [
          diff.empty? ? "No tracked changes in Git." : "### Tracked Git Diff:\n```diff\n#{diff}\n```",
          untracked_content.empty? ? nil : "### Untracked Files Content:\n#{untracked_content.join("\n\n")}"
        ].compact.join("\n\n")
      end

      def load_previous_critique
        prev_step = @iteration_count - 1
        audit_path = File.join(@env_path, "state", "critic_audit_#{@run_id}_step_#{prev_step}.md")
        if File.exist?(audit_path)
          begin
            File.read(audit_path, encoding: "utf-8")
          rescue StandardError
            "No previous critic audit exists."
          end
        else
          "No previous critic audit exists."
        end
      end

      def write_critic_audit_file(critique, advice, passed)
        audit_path = File.join(@env_path, "state", "critic_audit_#{@run_id}_step_#{@iteration_count}.md")
        FileUtils.mkdir_p(File.dirname(audit_path))

        status_str = passed ? "PASSING" : "FAILING"
        content = <<~MARKDOWN
          # Critic Audit Report
          - **Status**: #{status_str}
          - **Timestamp**: #{Time.now.strftime('%Y-%m-%d %H:%M:%S')}

          ## Critique
          #{critique}

          ## Advice
          #{advice}
        MARKDOWN
        begin
          File.write(audit_path, content, encoding: "utf-8")
        rescue StandardError => e
          @event_bus.emit(:warning, message: "Error writing critic audit file: #{e.message}")
        end
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
