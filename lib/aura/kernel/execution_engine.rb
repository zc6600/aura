require "open3"

module Aura
  module Kernel
    class ExecutionEngine
      def initialize(project_path)
        @project_path = project_path
      end

      def execute(tool_name, args)
        dir = File.join(@project_path, "tools", tool_name)
        manifest = read_manifest(dir)
        runtime = resolve_runtime(manifest["runtime"])
        entry = manifest["entry"] || "logic.py"
        logic = File.join(dir, entry)
        return { error: "entry not found: #{entry}" } unless File.exist?(logic)
        payload = (args || {}).to_json
        out, err, status = Open3.capture3(runtime, logic, payload, chdir: @project_path)
        body = err.to_s.strip.empty? ? out : err
        if status.success?
          obj = parse_json_safe(body)
          obj["status"] = obj["status"] || "ok"
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
            cfg = File.join(@project_path, "config", "config.yml")
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
    end
  end
end
