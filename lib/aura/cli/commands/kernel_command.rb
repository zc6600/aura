# frozen_string_literal: true

require "thor"

module Aura
  module Commands
    class KernelCommand < Thor
      def self.exit_on_failure?
        true
      end

      desc "observe [PROJECT_PATH]", "Observe current environment and assemble context"
      method_option :human, type: :boolean, aliases: "-H", default: false, desc: "Human-readable output"
      method_option :preview_lines, type: :numeric, aliases: "-n", default: 5, desc: "Lines to show in context preview"
      def observe(project_path = nil)
        require "aura/kernel"
        resolved_path = resolve_project_path!(project_path)
        runner = Aura::Kernel::Runner.new(File.expand_path(resolved_path))
        begin
          ctx = runner.observe
        rescue Aura::Context::ContextOverflowError => e
          ctx = "[Context overflow] #{e.message}"
        end

        if options[:human]
          puts ctx
        else
          puts({ context: ctx }.to_json)
        end
      end

      desc "run_call TOOL ARGS [PROJECT_PATH]", "Run a specific tool call"
      def run_call(tool, args_json, project_path = nil)
        require "aura/kernel"
        resolved_path = resolve_project_path!(project_path)
        runner = Aura::Kernel::Runner.new(File.expand_path(resolved_path))
        args = JSON.parse(args_json)
        out = runner.run_call({ "tool" => tool, "args" => args })
        puts out.is_a?(String) ? out : out.to_json
      end

      desc "once [PROJECT_PATH]", "Run Kernel once with a provided call payload"
      method_option :call, type: :string, aliases: "-c", desc: "JSON payload: {\"tool\":..., \"args\":{...}}"
      method_option :input, type: :string, aliases: "-i", desc: "User input to plan a single call when no payload is provided"
      method_option :ask, type: :boolean, aliases: "-a", default: false, desc: "Prompt for user input if not provided"
      method_option :human, type: :boolean, aliases: "-H", default: false, desc: "Human-readable output"
      method_option :verbose, type: :boolean, aliases: "-v", default: false, desc: "Show detailed output"
      method_option :preview_lines, type: :numeric, aliases: "-n", default: 5, desc: "Lines to show in context preview"
      def once(project_path = nil)
        require "aura/kernel"
        resolved_path = resolve_project_path!(project_path)
        runner = Aura::Kernel::Runner.new(File.expand_path(resolved_path))
        input = options[:input]
        if options[:ask] && input.to_s.strip.empty?
          $stdout.print "Input> "
          $stdout.flush
          input = $stdin.gets.to_s
        end
        input = input.to_s.strip
        runner.record_user_input(input) unless input.empty?
        begin
          ctx = runner.observe
        rescue Aura::Context::ContextOverflowError => e
          ctx = "[Context overflow] #{e.message}"
        end
        payload = options[:call] ? JSON.parse(options[:call]) : nil
        if payload.nil? && !input.empty?
          plan = runner.plan(input, ctx)
          if plan && (plan[:tool] || plan["tool"])
            tool = plan[:tool] || plan["tool"]
            args = plan[:args] || plan["args"] || {}
            summary = plan[:summary] || plan["summary"]
            payload = { "tool" => tool, "args" => args, "summary" => summary }
          end
        end
        verbose = options[:verbose] || ENV["VERBOSE"] == "true"
        if payload
          out = runner.run_call(payload)
          if options[:human]
            puts human_kernel_output(ctx, out, payload, options[:preview_lines], verbose)
          else
            preview = ctx.split("\n").first(options[:preview_lines]).join("\n")
            puts({ context_preview: preview, result: out }.to_json)
          end
        elsif options[:human]
          puts human_kernel_output(ctx, nil, nil, options[:preview_lines], verbose)
        else
          puts ctx
        end
      end

      desc "plan [PROJECT_PATH]", "Run planner to produce next step"
      method_option :goal, type: :string, aliases: "-g", desc: "Goal text to guide planning"
      method_option :human, type: :boolean, aliases: "-H", default: false, desc: "Human-readable output"
      method_option :preview_lines, type: :numeric, aliases: "-n", default: 5, desc: "Lines to show in context preview"
      def plan(project_path = nil)
        require "aura/kernel"
        resolved_path = resolve_project_path!(project_path)
        runner = Aura::Kernel::Runner.new(File.expand_path(resolved_path))
        ctx = nil
        begin
          ctx = runner.observe
          res = runner.plan(options[:goal], ctx)
        rescue Aura::Context::ContextOverflowError => e
          ctx = "[Context overflow] #{e.message}"
          res = runner.plan(options[:goal], ctx)
        end
        preview = ctx.split("\n").first(options[:preview_lines]).join("\n")
        if options[:human]
          puts [
            "== Context Preview ==",
            preview,
            "== Plan ==",
            res.to_json
          ].join("\n")
        else
          puts({ context_preview: preview, plan: res }.to_json)
        end
      end

      desc "loop [PROJECT_PATH]", "Loop planner and tool calls until final"
      method_option :goal, type: :string, aliases: "-g", desc: "Goal text to guide planning"
      method_option :human, type: :boolean, aliases: "-H", default: false, desc: "Human-readable output"
      method_option :verbose, type: :boolean, aliases: "-v", default: false, desc: "Show detailed output"
      method_option :max_steps, type: :numeric, aliases: "-m", desc: "Maximum loop steps"
      def loop(project_path = nil)
        require "aura/kernel"
        require "aura/kernel/agent_loop"
        resolved_path = resolve_project_path!(project_path)
        runner = Aura::Kernel::Runner.new(File.expand_path(resolved_path))

        agent_loop = Aura::Kernel::AgentLoop.new(runner)
        max_steps = options[:max_steps] ? options[:max_steps].to_i : 30
        res = agent_loop.run(options[:goal], max_steps: max_steps)

        formatted_steps = res.steps.map do |step|
          payload = { "tool" => step[:tool], "args" => step[:args], "summary" => step[:summary] }
          format_loop_step(payload, step[:result])
        end

        final_res = if res.status == :completed
                      res.steps.last ? res.steps.last[:result] : { "status" => "completed", "content" => res.final_content }
                    else
                      { "status" => "failed", "reason" => res.failure_reason || "aborted", "steps" => res.steps.size }
                    end

        if options[:human]
          verbose = options[:verbose] || ENV["VERBOSE"] == "true"
          puts formatted_steps.map { |s| human_loop_step(s, verbose) }.join("\n")
        else
          puts({ steps: formatted_steps, final: final_res }.to_json)
        end
      end

      no_commands do
        def human_kernel_output(ctx, out, payload, nlines, verbose)
          lines = []
          lines << "== Context Preview =="
          lines << ctx.split("\n").first(nlines).join("\n")
          lines << "== Call =="
          if payload
            lines << "Tool: #{payload['tool']}"
            lines << "Args: #{(payload['args'] || {}).to_json}" if verbose
            lines << "Summary: #{payload['summary']}" if payload["summary"] && !payload["summary"].to_s.empty?
          else
            lines << "(no call provided)"
          end
          lines << "== Result =="
          if out.nil?
            lines << "(no execution)"
          elsif out.is_a?(Hash)
            status = out["status"] || out[:status] || "ok"
            lines << if %w[blocked upgrade_required].include?(status.to_s)
                       "Status: #{status} (Tool execution blocked/failed)"
                     else
                       "Status: #{status}"
                     end
            body = format_result_body(out)
            body = truncate_output(body, 5) unless verbose
            lines << body.to_s
          else
            lines << out.to_s
          end
          lines.join("\n")
        end

        def format_loop_step(payload, out)
          tool = payload["tool"]
          args = payload["args"] || {}
          summary = payload["summary"]
          status = out.is_a?(Hash) ? (out["status"] || out[:status]) : nil
          body = if out.is_a?(Hash)
                   out["content"] || out["output"] || out["message"] || out["stdout"] || out["stderr"] || out.to_json
                 else
                   out.to_s
                 end
          { "tool" => tool, "args" => args, "summary" => summary, "status" => status, "output" => body }
        end

        def human_loop_step(step, verbose)
          lines = []
          lines << "== Step =="
          lines << "Tool: #{step['tool']}"
          lines << "Args: #{(step['args'] || {}).to_json}" if verbose
          lines << "Summary: #{step['summary']}" if step["summary"] && !step["summary"].to_s.empty?
          lines << "Status: #{step['status']}" if step["status"]
          lines << "Output:"
          body = step["output"].to_s
          body = truncate_output(body, 5) unless verbose
          lines << body
          lines.join("\n")
        end

        def truncate_output(body, max_lines)
          return "" if body.nil?

          lines = body.to_s.lines
          return body.to_s if lines.size <= max_lines

          "#{lines[0...max_lines].join.strip}..."
        end

        def format_result_body(res)
          return res.to_s unless res.is_a?(Hash)

          candidates = [res["content"], res["output"], res["message"], res["stdout"], res["stderr"]]
          found = candidates.find { |v| v && !v.to_s.strip.empty? }
          return found.to_s if found

          keys = res.keys.map(&:to_s)
          return "Result returned (fields: #{keys.join(', ')})" if keys.any?

          "Result returned"
        end

        def resolve_project_path!(project_path)
          Aura.resolve_project_path!(project_path)
        end
      end
    end
  end
end
