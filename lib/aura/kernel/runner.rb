require "json"
require "open3"
require "aura"
require "aura/context"
require "aura/kernel/state"
require "aura/context/state_recorder"
require "aura/kernel/registry"
require "aura/kernel/tool_validator"
require "aura/kernel/execution_engine"
require "aura/ext/lsp/manager"
require "aura/kernel/planner"
require "aura/kernel/memory_metabolizer"
require_relative "event_emitter"
require_relative "hooks"
require_relative "job"

module Aura
  module Kernel
    class Runner
      include EventEmitter

      attr_reader :hooks, :current_job

      def initialize(project_path)
        @project_path = File.expand_path(project_path)
        @env_path = Aura::PathResolver.environment_path(@project_path)
        
        @state = Aura::Kernel::State.new(@env_path)
        @recorder = Aura::Context::StateRecorder.new(@state)
        @validator = Aura::Kernel::ToolValidator.new(@env_path, nil, @state)
        @lsp_manager = Aura::LSP::Manager.new(@project_path)
        @engine = Aura::Kernel::ExecutionEngine.new(@project_path, env_path: @env_path, lsp_manager: @lsp_manager)
        @registry = Aura::Kernel::ToolRegistry.new(@env_path)
        @metabolizer = Aura::Kernel::MemoryMetabolizer.new(
          @state,
          event_bus: self,  # Runner acts as event_bus (has emit method)
          config: { project_path: @project_path },
          registry: @registry  # Pass registry to read manifest memory settings
        )
        @context_manager = Aura::Context::Manager.new(@env_path)
        @hooks = Aura::Kernel::Hooks.new
        @planner = Aura::Kernel::Planner.new(@project_path, env_path: @env_path)
        @current_job = nil
        @lock = Mutex.new # Serialize executions
        
        # Ensure database connection is properly closed on exit
        at_exit { @state.close rescue nil }
      end

      def load_config
        path = File.join(@env_path, "config", "config.yml")
        begin
          require "yaml"
          File.exist?(path) ? Aura.safe_load_yaml(path) : {}
        rescue StandardError
          {}
        end
      end

      def start_job(metadata = {})
        @lock.synchronize do
          if @current_job && @current_job.status == :running
             # For now, simplistic check. In future, queueing.
             raise "Runner is busy with job #{@current_job.id}"
          end
          @current_job = Aura::Kernel::Job.new(metadata)
          @current_job.start!
        end
        emit(:job_start, @current_job.to_h)
        @current_job
      end

      def end_job(status = :completed, error = nil)
        job = nil
        @lock.synchronize do
          return unless @current_job

          if status == :failed && error
            @current_job.fail!(error)
          else
            @current_job.complete!
          end
          job = @current_job
          @current_job = nil
        end
        
        emit(:job_end, job.to_h)
        job
      end

      def observe
        @state.record_event({ phase: "observe" })
        @metabolizer.metabolize  # Now uses MemoryMetabolizer with event_bus
        auto_verify_core_tools
        Aura::Context.assemble(@project_path, @state, lsp_manager: @lsp_manager)
      end

      def plan(goal = nil, context = nil)
        ctx = context || observe
        
        # Hook: before_planning (allows modifying context/goal)
        # We pass a context object (or hash) that can be modified in place if it were an object.
        # Since strings are immutable-ish in this context, we'll pass a hash wrapper.
        payload = { context: ctx, goal: goal }
        @hooks.run(:before_planning, payload)
        ctx = payload[:context]
        goal = payload[:goal]

        res = @planner.plan(ctx, goal)
        @recorder.record_plan(res)
        res
      end

      def plan_stream(goal = nil, context = nil)
        ctx = context || observe

        # Hook: before_planning
        payload = { context: ctx, goal: goal }
        @hooks.run(:before_planning, payload)
        ctx = payload[:context]
        goal = payload[:goal]

        res = @planner.plan_stream(ctx, goal) do |ev|
          yield(ev) if block_given?
        end
        @recorder.record_plan(res)
        res
      end

      def record_user_input(input)
        @last_user_event_id = @recorder.record_user(input)
        @current_job.add_event(@last_user_event_id) if @current_job
        @last_user_event_id
      end

      def run_call(call)
        tool = call["tool"]
        args = call["args"] || {}
        summary = call["summary"]
        
        emit(:tool_start, { tool: tool, args: args, summary: summary })

        # Run hooks
        unless @hooks.run(:before_tool_execution, tool, args)
          emit(:tool_blocked, { tool: tool, reason: "Hook rejected execution" })
          return { status: "blocked", advice: "Execution rejected by hook" }
        end

        st = @validator.status_for(tool)
        unless st[:state] == "ready"
          advice = st[:reason]
          @recorder.record_interception(tool, advice)
          emit(:tool_blocked, { tool: tool, reason: advice })
          return { status: "blocked", advice: advice }
        end
        act = @validator.ensure_active(tool)
        unless act[:ok]
          @recorder.record_interception(tool, act[:advice])
          emit(:tool_blocked, { tool: tool, reason: act[:advice] })
          return { status: "upgrade_required", advice: act[:advice] }
        end
        
        emit(:tool_executing, { tool: tool })
        
        # Track file modifications
        modified_files = track_file_modifications do
          res = @engine.execute(tool, args)
        end
        
        # Hook: after_tool_execution (allows transforming result)
        # Payload wrapper to allow modification
        res_payload = { result: res, tool: tool }
        @hooks.run(:after_tool_execution, res_payload)
        res = res_payload[:result]
        
        # Add modified files to result if any
        if modified_files && !modified_files.empty?
          res = res.is_a?(Hash) ? res : { status: "ok" }
          res["modified_files"] = modified_files
        end

        emit(:tool_result, { tool: tool, result: res })

        call_seq = @last_user_event_id
        event_id = @recorder.record_execution(tool, res, call_seq: call_seq)
        @current_job.add_event(event_id) if @current_job
        
        handle_context_lifecycle(tool, args, res)
        begin
          maxc = fetch_call_summary_max
          s = summary.to_s if summary
          s = s[0, maxc] if maxc && s.length > maxc
          @state.commit_summary(s, call_seq || event_id) if s && !s.empty?
        rescue StandardError
        end
        @state.metabolize_if_needed
        res
      end

      def undo
        @state.undo_last_turn
      end

      def redo
        @state.redo_last_turn
      end

      private
        def handle_context_lifecycle(tool, args, res)
          tool_data = @registry.find(tool)
          manifest = tool_data ? (tool_data[:manifest] || {}) : {}

          if manifest["creates_context"]
            ctx_type = manifest["creates_context"]
            ctx_data = res.is_a?(Hash) && res["data"].is_a?(Hash) ? res["data"] : {}
            context_id = res.is_a?(Hash) ? res["context_id"] : nil
            if context_id && !context_id.to_s.empty?
              @context_manager.add_context(ctx_type, ctx_data, id: context_id)
            else
              new_id = @context_manager.add_context(ctx_type, ctx_data)
              res["context_id"] = new_id if res.is_a?(Hash)
            end
          end

          if manifest["destroys_context"]
            destroy_id = args["context_id"] || (res.is_a?(Hash) ? res["context_destroyed"] : nil)
            @context_manager.remove_context(destroy_id) if destroy_id && !destroy_id.to_s.empty?
          elsif manifest["requires_context"]
            use_id = args["context_id"]
            @context_manager.update_activity(use_id) if use_id && !use_id.to_s.empty?
          end
        end
        def fetch_call_summary_max
          load_config.dig("tool_protocol", "call_summary", "max_chars")
        end

        def core_tools_from_config
          list = load_config.dig("tool_protocol", "core_tools") || []
          list.is_a?(Array) ? list.compact.map(&:to_s) : []
        end

        def auto_verify_from_config
          list = load_config.dig("tool_protocol", "auto_verify") || []
          list.is_a?(Array) ? list.compact.map(&:to_s) : []
        end

        def auto_verify_core_tools
          names = (core_tools_from_config + auto_verify_from_config).uniq
          return if names.empty?
          names.each do |name|
            st = @validator.status_for(name)
            next unless st[:state] == "ready"
            @validator.ensure_active(name)
          end
        end
        
        # Track file modifications during tool execution
        def track_file_modifications
          # Get file state before execution
          before_state = get_file_state
          
          # Execute the tool
          yield
          
          # Get file state after execution
          after_state = get_file_state
          
          # Compare and return modified files
          modified = after_state.keys - before_state.keys  # New files
          
          # Check for modified existing files (different mtime or size)
          after_state.each do |path, info|
            if before_state[path]
              if before_state[path][:mtime] != info[:mtime] || before_state[path][:size] != info[:size]
                modified << path unless modified.include?(path)
              end
            end
          end
          
          # Filter to only include files in project directory
          modified.select! { |f| f.start_with?(@project_path) }
          
          # Convert to relative paths
          modified.map! { |f| f.sub(@project_path + "/", "") }
          
          modified
        end
        
        # Get current file state (path -> {mtime, size})
        def get_file_state
          state = {}
          Dir.glob("#{@project_path}/**/*").each do |path|
            next unless File.file?(path)
            next if path.include?("/.git/")
            next if path.include?("/.aura/")
            stat = File.stat(path)
            state[path] = { mtime: stat.mtime.to_i, size: stat.size }
          end
          state
        rescue StandardError
          {}
        end
    end
  end
end
