# frozen_string_literal: true

require "json"
require "open3"
require "aura"
require "aura/context"
require "aura/memory"
require "aura/kernel/registry"
require "aura/kernel/tool_validator"
require "aura/kernel/execution_engine"
require "aura/ext/lsp/manager"
require "aura/kernel/planner"
require "aura/config_loader"
require_relative "event_emitter"
require_relative "hooks"
require_relative "job"

module Aura
  module Kernel
    class Runner
      include EventEmitter

      attr_reader :hooks, :current_job, :memory, :planner, :project_path, :env_path
      alias workspace_path project_path

      def initialize(project_path, memory: nil)
        @project_path = File.expand_path(project_path)
        @env_path = Aura::PathResolver.environment_path(@project_path)

        @registry = Aura::Kernel::ToolRegistry.new(@env_path)
        @memory = memory || default_memory
        @validator = Aura::Kernel::ToolValidator.new(@project_path, @registry, @memory, env_path: @env_path)
        @lsp_manager = Aura::LSP::Manager.new(@project_path)
        @engine = Aura::Kernel::ExecutionEngine.new(@project_path, env_path: @env_path, lsp_manager: @lsp_manager)
        @context_manager = Aura::Context::Manager.new(@env_path)
        @hooks = Aura::Kernel::Hooks.new
        @planner = Aura::Kernel::Planner.new(@project_path, env_path: @env_path)
        @current_job = nil
        @lock = Mutex.new

        at_exit do
          @memory.store.close
        rescue StandardError
          nil
        end
      end

      # Hot-swap the active SQLite database session to achieve physical amnesia without runner re-instantiation
      def reconnect_session!(session_name)
        ENV["AURA_SESSION_NAME"] = session_name
        if @memory && @memory.respond_to?(:store) && @memory.store
          begin
            @memory.store.close
          rescue StandardError
            nil
          end
        end
        @memory = default_memory
        @validator = Aura::Kernel::ToolValidator.new(@project_path, @registry, @memory, env_path: @env_path)
        @planner = Aura::Kernel::Planner.new(@project_path, env_path: @env_path)
      end

      def load_config
        Aura::ConfigLoader.load(@env_path, safe: true)
      end

      def start_job(metadata = {})
        @lock.synchronize do
          raise "Runner is busy with job #{@current_job.id}" if @current_job && @current_job.status == :running

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
        @memory.recorder.record_custom("observe", {})
        @memory.metabolize_if_needed
        auto_verify_core_tools
        Aura::Context.assemble(@project_path, @memory, lsp_manager: @lsp_manager)
      end

      def plan(goal = nil, context = nil)
        ctx = context || observe

        payload = { context: ctx, goal: goal }
        @hooks.run(:before_planning, payload)
        ctx = payload[:context]
        goal = payload[:goal]

        res = @planner.plan(ctx, goal)
        @memory.recorder.record_plan(res)
        res
      end

      def plan_stream(goal = nil, context = nil)
        ctx = context || observe

        payload = { context: ctx, goal: goal }
        @hooks.run(:before_planning, payload)
        ctx = payload[:context]
        goal = payload[:goal]

        res = @planner.plan_stream(ctx, goal) do |ev|
          yield(ev) if block_given?
        end
        @memory.recorder.record_plan(res)
        res
      end

      def record_user_input(input)
        @last_user_event_id = @memory.recorder.record_user(input)
        @current_job.add_event(@last_user_event_id) if @current_job
        @last_user_event_id
      end

      def run_call(call)
        tool = call["tool"]
        args = call["args"] || {}
        summary = call["summary"]

        emit(:tool_start, { tool: tool, args: args, summary: summary })

        unless @hooks.run(:before_tool_execution, tool, args)
          emit(:tool_blocked, { tool: tool, reason: "Hook rejected execution" })
          return { status: "blocked", advice: "Execution rejected by hook" }
        end

        st = @validator.status_for(tool)
        unless st[:state] == "ready"
          advice = st[:reason]
          @memory.recorder.record_interception(tool, advice)
          emit(:tool_blocked, { tool: tool, reason: advice })
          return { status: "blocked", advice: advice }
        end
        act = @validator.ensure_active(tool)
        unless act[:ok]
          @memory.recorder.record_interception(tool, act[:advice])
          emit(:tool_blocked, { tool: tool, reason: act[:advice] })
          return { status: "upgrade_required", advice: act[:advice] }
        end

        emit(:tool_executing, { tool: tool })

        res = nil
        modified_files = track_file_modifications do
          res = @engine.execute(tool, args)
        end

        res_payload = { result: res, tool: tool }
        @hooks.run(:after_tool_execution, res_payload)
        res = res_payload[:result]

        if modified_files && !modified_files.empty?
          res = { status: "ok" } unless res.is_a?(Hash)
          res["modified_files"] = modified_files
        end

        emit(:tool_result, { tool: tool, result: res })

        call_seq = @last_user_event_id
        event_id = @memory.recorder.record_execution(tool, res, call_seq: call_seq)
        @current_job.add_event(event_id) if @current_job

        handle_context_lifecycle(tool, args, res)
        begin
          maxc = fetch_call_summary_max
          s = summary.to_s if summary
          s = s[0, maxc] if maxc && s && s.length > maxc
          @memory.recorder.record_summary(s, call_seq || event_id) if s && !s.empty?
        rescue StandardError
        end
        res
      end

      def undo
        @memory.undo
      end

      def redo
        @memory.redo
      end

      private

      def default_memory
        config = Aura::Memory::Config.new(
          store: { project_path: @env_path },
          metabolism: load_config.dig("state_management") || {}
        )
        Aura::Memory::Base.new(
          config: config,
          event_bus: self,
          registry: @registry
        )
      end

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

      def track_file_modifications
        before_state = get_file_state
        yield
        after_state = get_file_state

        modified = after_state.keys - before_state.keys

        after_state.each do |path, info|
          next unless before_state[path]

          modified << path if (before_state[path][:mtime] != info[:mtime] || before_state[path][:size] != info[:size]) && !modified.include?(path)
        end

        modified.select! { |f| f.start_with?(@project_path) }
        modified.map! { |f| f.sub(@project_path + "/", "") }
        modified
      end

      def get_file_state
        state = {}
        Dir.glob("#{@project_path}/**/*", File::FNM_DOTMATCH).each do |path|
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
