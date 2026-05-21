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
        cfg = load_full_config
        args ||= {}

        # Resolve timeout parameters
        default_timeout = cfg.dig("tool_protocol", "default_timeout_seconds") || 300
        max_timeout = cfg.dig("tool_protocol", "max_timeout_seconds") || 1200
        config_agent_can_modify = cfg.dig("tool_protocol", "agent_can_modify_timeout") != false

        # Fetch manifest if tool exists in registry
        tool_data = @registry.find(tool_name)
        manifest = tool_data ? (tool_data[:manifest] || {}) : {}

        # Determine if agent can modify timeout
        agent_can_modify = manifest.key?("agent_can_modify_timeout") ? manifest["agent_can_modify_timeout"] : config_agent_can_modify

        # Base timeout: manifest timeout or system default
        base_timeout = manifest["timeout"] || default_timeout

        # Check for agent override
        args_timeout = args["timeout_seconds"] || args["timeout"]
        if args_timeout && agent_can_modify
          resolved_timeout = args_timeout.to_f
        else
          resolved_timeout = base_timeout.to_f
        end

        # Enforce maximum timeout upper bound
        resolved_timeout = [resolved_timeout, max_timeout.to_f].min

        # Execute dispatching
        if @mcp_manager.mcp_tool?(tool_name)
          begin
            require "timeout"
            return Timeout.timeout(resolved_timeout) do
              @mcp_manager.call_tool(tool_name, args)
            end
          rescue Timeout::Error
            return { error: "Tool execution timed out after #{resolved_timeout} seconds.", status: "failed" }
          end
        end

        if tool_name.to_s == "lsp_diagnostics"
          require "aura/kernel/tools/lsp_diagnostics"
          begin
            require "timeout"
            return Timeout.timeout(resolved_timeout) do
              Aura::Kernel::Tools::LSPDiagnostics.new(@lsp_manager).execute(args)
            end
          rescue Timeout::Error
            return { error: "Tool execution timed out after #{resolved_timeout} seconds.", status: "failed" }
          end
        end

        if tool_name.to_s == "remember_fact"
          require "aura/kernel/tools/remember_fact"
          begin
            require "timeout"
            return Timeout.timeout(resolved_timeout) do
              Aura::Kernel::Tools::RememberFact.new(@project_path).execute(args)
            end
          rescue Timeout::Error
            return { error: "Tool execution timed out after #{resolved_timeout} seconds.", status: "failed" }
          end
        end

        return { error: "tool not found in registry: #{tool_name}", status: "failed" } unless tool_data

        dir = tool_data[:path]
        runtime_data = manifest["runtime"]
        runtime_key = runtime_data.is_a?(Hash) ? (runtime_data["language"] || runtime_data["runtime"]) : runtime_data
        runtime = resolve_runtime(runtime_key)
        entry = manifest["entry"] || (runtime_data.is_a?(Hash) ? runtime_data["entry_point"] : nil) || "logic.py"
        logic = File.join(dir, entry)
        return { error: "entry not found: #{entry}", status: "failed" } unless File.exist?(logic)

        # Inject context-aware security permissions if strict isolation is on
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
        
        begin
          # Always use stdin for payload transfer to avoid dual-channel confusion
          out, err, status = capture3_with_timeout(cmd, final_args, @project_path, resolved_timeout)
        rescue Timeout::Error
          return { error: "Tool execution timed out after #{resolved_timeout} seconds.", status: "failed" }
        end

        body = err.to_s.strip.empty? ? out : err
        if status.success?
          obj = parse_json_safe(body)
          obj["status"] = obj["status"] || "ok"
          
          # Run shadow backup to track changes locally
          begin
            require "aura/kernel/shadow_backup"
            Aura::Kernel::ShadowBackup.new(@project_path).record_changes(tool_name, args)
          rescue StandardError
          end

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
        def capture3_with_timeout(cmd, stdin_data, chdir, timeout_val)
          pid = nil
          stdout_data = ""
          stderr_data = ""
          status = nil
          
          begin
            require "timeout"
            Timeout.timeout(timeout_val + 2) do
              Open3.popen3(*cmd, chdir: chdir) do |stdin, stdout, stderr, wait_thr|
                pid = wait_thr.pid
                
                # Write stdin in a separate thread to prevent pipe deadlock
                write_thread = Thread.new do
                  begin
                    stdin.write(stdin_data) if stdin_data
                    stdin.close
                  rescue IOError, StandardError
                  end
                end
                
                # Read stdout and stderr in separate threads
                stdout_thread = Thread.new do
                  begin
                    stdout.read
                  rescue IOError, StandardError
                    ""
                  end
                end
                stderr_thread = Thread.new do
                  begin
                    stderr.read
                  rescue IOError, StandardError
                    ""
                  end
                end
                
                begin
                  unless wait_thr.join(timeout_val)
                    raise Timeout::Error, "Tool execution timed out after #{timeout_val} seconds."
                  end
                  stdout_data = stdout_thread.value
                  stderr_data = stderr_thread.value
                  status = wait_thr.value
                ensure
                  stdout_thread.kill rescue nil
                  stderr_thread.kill rescue nil
                  write_thread.kill rescue nil
                end
              end
            end
            [stdout_data, stderr_data, status]
          rescue Timeout::Error
            if pid
              begin
                Process.kill("TERM", pid)
                Timeout.timeout(2) { Process.wait(pid) }
              rescue StandardError
                begin
                  Process.kill("KILL", pid)
                  Process.wait(pid)
                rescue StandardError
                end
              end
            end
            raise
          end
        end

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
            m = File.exist?(cfg) ? Aura.safe_load_yaml(cfg) : {}
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
          File.exist?(path) ? Aura.safe_load_yaml(path) : {}
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
