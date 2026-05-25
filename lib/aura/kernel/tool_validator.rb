# frozen_string_literal: true

require "open3"
require "aura/kernel/registry"
require "aura/context/manager"
require "aura/config_loader"

module Aura
  module Kernel
    class ToolValidator
      def initialize(path, registry = nil, state = nil, workspace_path: nil, env_path: nil)
        resolved_workspace = workspace_path || (defined?(Aura) && Aura.respond_to?(:workspace_path) ? (Aura::PathResolver.workspace_path(path) || path) : path)
        resolved_env = env_path || (defined?(Aura) && Aura.respond_to?(:environment_path) ? (Aura::PathResolver.environment_path(path) || path) : path)
        @workspace_path = File.expand_path(resolved_workspace)
        @env_path = File.expand_path(resolved_env)
        @registry = registry || Aura::Kernel::ToolRegistry.new(@workspace_path)
        if defined?(Aura::Memory) && state.is_a?(Aura::Memory::Base)
          require "aura/memory/adapters/compatibility_adapter"
          @state = Aura::Memory::Adapters::CompatibilityAdapter.new(state)
        else
          @state = state
        end
      end

      def status_for(name)
        return { state: "draft", reason: "tool name is nil" } if name.nil? || name.to_s.empty?
        return { state: "ready", verified: true } if name.to_s.start_with?("mcp.")

        tool_data = @registry.find(name)
        unless tool_data
          ws_dir = File.join(@workspace_path, "tools", name)
          env_dir = File.join(@env_path, "tools", name)
          found_dir = Dir.exist?(ws_dir) ? ws_dir : (Dir.exist?(env_dir) ? env_dir : nil)
          return { state: "draft", reason: "missing: manifest.json" } if found_dir && !File.exist?(File.join(found_dir, "manifest.json"))

          return { state: "draft", reason: "tool not found: #{name}" }
        end

        dir = tool_data[:path]
        manifest = tool_data[:manifest] || {}
        cfg = load_config
        req = cfg.dig("tool_protocol", "required_files") || []
        test_file = manifest["test"] || manifest.dig("verification", "test_file") || "test.py"
        skip_test = manifest["skip_test"] == true || (manifest.dig("verification", "require_test") == false)
        req = req.reject { |f| skip_test && (f == test_file || f == "test.py") }
        missing = req.reject { |f| File.exist?(File.join(dir, f)) }
        return { state: "draft", reason: "missing: #{missing.join(', ')}" } unless missing.empty?

        # Check if it was previously verified
        if @state
          vars = @state.get_active_variables
          return { state: "ready", verified: true } if vars["tool_status:#{name}"] == "ready"
        end

        if skip_test
          { state: "ready", verified: false }
        else
          { state: "ready" }
        end
      end

      def ensure_active(name)
        return { ok: true } if name.to_s.start_with?("mcp.")

        tool_data = @registry.find(name)
        return { ok: false, advice: "tool not found: #{name}" } unless tool_data

        dir = tool_data[:path]
        manifest = tool_data[:manifest]

        # Cache Check: If state is available and file hasn't changed, skip test
        return { ok: true, cached: true } if @state && cache_valid?(name, dir)

        # Context Check
        req_context = manifest["requires_context"]
        if req_context
          active = context_manager.active_contexts(req_context)
          if active.empty?
            return { ok: false,
                     advice: "Tool '#{name}' requires active '#{req_context}' context. Please call an entry tool (like '#{find_entry_for(req_context)}') first." }
          end
        end

        skip_test = manifest["skip_test"] == true || (manifest.dig("verification", "require_test") == false)
        unless skip_test
          test_entry = manifest["test"] || manifest.dig("verification", "test_file") || "test.py"
          runtime_key = manifest["runtime"]
          runtime_key = runtime_key["language"] || runtime_key["runtime"] if runtime_key.is_a?(Hash)
          runtime = resolve_runtime(runtime_key)
          test_path = File.join(dir, test_entry)
          return { ok: false, advice: "missing test: #{test_entry}" } unless File.exist?(test_path)
        end

        # Use standardized tool runner
        runner_script = File.expand_path("../../runners/tool_runner.py", __dir__)

        if skip_test
          mark_verified(name, dir) if @state
          { ok: true }
        else
          if File.exist?(runner_script)
            cmd = [runtime, runner_script, dir]
            out, err, status = Open3.capture3(*cmd, chdir: @workspace_path)
          else
            out, err, status = Open3.capture3(runtime, test_path, chdir: @workspace_path)
          end
          if status.success?
            mark_verified(name, dir) if @state
            return { ok: true, out: out }
          end
          mark_failed(name, err.empty? ? out : err) if @state
          { ok: false, advice: build_advice(name, err.empty? ? out : err) }
        end
      end

      def build_advice(name, trace)
        lines = trace.to_s.split("\n").last(20).join("\n")
        "Tool '#{name}' test failed. Fix logic.py or manifest.json. Traceback:\n#{lines}"
      end

      private

      def load_config
        Aura::ConfigLoader.load(@env_path)
      end

      def resolve_runtime(key)
        key ||= "python"
        cfg = load_config
        resolved = cfg.dig("tool_protocol", "runtimes", key.to_s) || key.to_s
        resolved = "python" if resolved == "python3"
        resolved
      end

      def cache_valid?(name, dir)
        return false unless @state

        vars = @state.get_active_variables
        return false unless vars["tool_status:#{name}"] == "ready"

        last_mtime = vars["tool_mtime:#{name}"]
        return false unless last_mtime

        current_mtime = max_mtime(dir)
        last_mtime.to_i == current_mtime
      end

      def mark_verified(name, dir)
        return unless @state

        @state.set_variable("tool_status:#{name}", "ready")
        @state.set_variable("tool_mtime:#{name}", max_mtime(dir))
        @state.set_variable("tool_error:#{name}", "")
      end

      def mark_failed(name, error)
        return unless @state

        @state.set_variable("tool_status:#{name}", "failed")
        # Save the last line (actual exception) instead of just "Traceback..."
        msg = error.to_s.strip.split("\n").last || error.to_s
        @state.set_variable("tool_error:#{name}", msg)
      end

      def max_mtime(dir)
        # Get max mtime of any file in tool directory (non-recursive)
        files = Dir.glob(File.join(dir, "*"))
        return 0 if files.empty?

        files.map { |f| File.mtime(f).to_i }.max
      end

      def read_manifest(dir)
        path = File.join(dir, "manifest.json")
        begin
          File.exist?(path) ? JSON.parse(File.read(path)) : {}
        rescue StandardError
          {}
        end
      end

      def context_manager
        @context_manager ||= Aura::Context::Manager.new(@env_path)
      end

      def find_entry_for(context_type)
        @registry.all_tools.each do |tname|
          t = @registry.find(tname)
          return tname if t[:manifest]["creates_context"] == context_type
        end
        "entry tool"
      end
    end
  end
end
