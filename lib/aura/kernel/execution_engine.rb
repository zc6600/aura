require "open3"
require "aura"
require "aura/ext/mcp/manager"
require "aura/kernel/registry"
require_relative "git_state"

module Aura
  module Kernel
    class ExecutionEngine
      def initialize(project_path, options = {})
        @project_path = File.expand_path(project_path)
        @env_path = options[:env_path] || Aura.environment_path(@project_path)
        @registry = Aura::Kernel::ToolRegistry.new(@env_path)
        @mcp_manager = Aura::MCP::Manager.new(@env_path)
        @lsp_manager = options[:lsp_manager]
      end

      def execute(tool_name, args)
        if @mcp_manager.mcp_tool?(tool_name)
          return @mcp_manager.call_tool(tool_name, args)
        end

        if tool_name.to_s == "lsp_diagnostics"
          require "aura/kernel/tools/lsp_diagnostics"
          return Aura::Kernel::Tools::LSPDiagnostics.new(@lsp_manager).execute(args)
        end

        if tool_name.to_s == "remember_fact"
          require "aura/kernel/tools/remember_fact"
          return Aura::Kernel::Tools::RememberFact.new(@project_path).execute(args)
        end

        tool_data = @registry.find(tool_name)
        return { error: "tool not found in registry: #{tool_name}", status: "failed" } unless tool_data

        dir = tool_data[:path]
        manifest = tool_data[:manifest]
        runtime_data = manifest["runtime"]
        runtime_key = runtime_data.is_a?(Hash) ? (runtime_data["language"] || runtime_data["runtime"]) : runtime_data
        runtime = resolve_runtime(runtime_key)
        entry = manifest["entry"] || (runtime_data.is_a?(Hash) ? runtime_data["entry_point"] : nil) || "logic.py"
        logic = File.join(dir, entry)
        return { error: "entry not found: #{entry}", status: "failed" } unless File.exist?(logic)

        # Inject context-aware security permissions if strict isolation is on
        cfg = load_full_config
        args ||= {}
        strict = cfg.dig("security", "strict_path_isolation") ? true : false
        args["strict_mode"] = strict unless args.key?("strict_mode")
        if cfg.dig("security", "strict_path_isolation")
          args["context_permissions"] ||= []
          args["context_permissions"] += ["./knowledge", "./tools", "AURA_README.md"]
          args["context_permissions"] = args["context_permissions"].compact.uniq
          args["forbidden_extensions"] ||= cfg.dig("security", "forbidden_extensions") || []
          args["read_only_directories"] ||= cfg.dig("security", "read_only_directories") || []
        end
        allowed = manifest.dig("permissions", "allow_paths") || []
        if allowed && !allowed.empty?
          args["context_permissions"] ||= []
          args["context_permissions"] += allowed
          args["context_permissions"] = args["context_permissions"].compact.uniq
        end

        # Inject default output truncation and bash base wait if configured
        begin
          call_out = cfg.dig("tool_protocol", "call_output") || {}
          args["max_output_chars"] ||= call_out["max_chars"] if call_out["max_chars"]
          args["head_ratio"] ||= call_out["head_ratio"] if call_out["head_ratio"]
          if tool_name.to_s == "bash_command"
            bash_cfg = cfg.dig("tool_protocol", "bash") || {}
            args["timeout_seconds"] ||= bash_cfg["base_wait_seconds"] if bash_cfg["base_wait_seconds"]
          end
        rescue StandardError
        end

        payload = args.to_json
        
        # Apply sandboxing if enabled
        cmd, final_args = apply_sandbox(cfg, runtime, logic, payload)
        
        out, err, status = Open3.capture3(*cmd, final_args, chdir: @project_path)
        body = err.to_s.strip.empty? ? out : err
        if status.success?
          obj = parse_json_safe(body)
          obj["status"] = obj["status"] || "ok"
          
          # Git snapshot if enabled
          if cfg.dig("security", "git_snapshots")
            Aura::Kernel::GitState.new(@project_path).snapshot(tool_name, success: true)
          end

          obj
        else
          { error: body, status: "failed" }
        end
      end

      private
        def read_manifest(dir)
          path = File.join(dir, "manifest.json")
          begin
            File.exist?(path) ? JSON.parse(File.read(path)) : {}
          rescue StandardError
            {}
          end
        end

        def resolve_runtime(key)
          key ||= "python"
          begin
            require "yaml"
            cfg = File.join(@env_path, "config", "config.yml")
            m = File.exist?(cfg) ? YAML.load_file(cfg) : {}
            m.dig("tool_protocol", "runtimes", key) || key
          rescue StandardError
            key
          end
        end

        def parse_json_safe(s)
          begin
            JSON.parse(s)
          rescue StandardError
            { output: s }
          end
        end

        def load_full_config
          require "yaml"
          path = File.join(@env_path, "config", "config.yml")
          File.exist?(path) ? YAML.load_file(path) : {}
        rescue StandardError
          {}
        end

        def apply_sandbox(cfg, runtime, logic, payload)
          sandbox = cfg.dig("security", "sandbox")
          return [[runtime, logic], payload] unless sandbox && sandbox["enabled"]

          case sandbox["provider"]
          when "docker"
            image = sandbox["image"] || "aura-sandbox:latest"
            # In docker mode, we mount the project path and run the tool
            # Note: This is a simplified implementation
            [
              ["docker", "run", "--rm", "-i", "-v", "#{@project_path}:/app", "-w", "/app", image, runtime, logic],
              payload
            ]
          when "local"
            # Local restricted execution (e.g. via a wrapper or lower-privilege user)
            # For now, we use a placeholder wrapper if it exists
            wrapper = File.join(@env_path, "bin", "sandbox-wrapper")
            if File.exist?(wrapper)
              [[wrapper, runtime, logic], payload]
            else
              [[runtime, logic], payload]
            end
          else
            [[runtime, logic], payload]
          end
        end
    end
  end
end
