require "thor"

module Aura
  module Commands
    class KernelCommand < Thor
      desc "once PROJECT_PATH", "Run Kernel once with a provided call payload"
      method_option :call, type: :string, aliases: "-c", desc: "JSON payload: {\"tool\":..., \"args\":{...}}"
      method_option :human, type: :boolean, aliases: "-H", default: false, desc: "Human-readable output"
      method_option :preview_lines, type: :numeric, aliases: "-n", default: 5, desc: "Lines to show in context preview"
      def once(project_path)
        require "aura/kernel"
        runner = Aura::Kernel::Runner.new(File.expand_path(project_path))
        begin
          ctx = runner.observe
        rescue Aura::Context::ContextOverflowError => e
          ctx = "[Context overflow] #{e.message}"
        end
        payload = options[:call] ? JSON.parse(options[:call]) : nil
        if payload
          out = runner.run_call(payload)
          if options[:human]
            puts human_kernel_output(ctx, out, payload, options[:preview_lines])
          else
            preview = ctx.split("\n").first(options[:preview_lines]).join("\n")
            puts({ context_preview: preview, result: out }.to_json)
          end
        else
          if options[:human]
            puts human_kernel_output(ctx, nil, nil, options[:preview_lines])
          else
            puts ctx
          end
        end
      end

      no_commands do
        def human_kernel_output(ctx, out, payload, nlines)
          lines = []
          lines << "== Context Preview =="
          lines << ctx.split("\n").first(nlines).join("\n")
          lines << "== Call =="
          if payload
            lines << "Tool: #{payload["tool"]}"
            lines << "Args: #{(payload["args"] || {}).to_json}"
          else
            lines << "(no call provided)"
          end
          lines << "== Result =="
          if out.nil?
            lines << "(no execution)"
          elsif out.is_a?(Hash)
            if %w[blocked upgrade_required].include?(out["status"]) && out["advice"]
              lines << "Status: #{out["status"]}"
              lines << "Advice: #{out["advice"]}"
            elsif out["error"]
              lines << "Error: #{out["error"]}"
            else
              lines << "Status: #{out["status"]}"
              body = out["content"] || out["output"] || out.to_json
              lines << body.to_s
            end
          else
            lines << out.to_s
          end
          lines.join("\n")
        end
      end
    end
  end
end
