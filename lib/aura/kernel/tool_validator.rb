module Aura
  module Kernel
    class ToolValidator
      def initialize(project_path)
        @project_path = project_path
      end

      def status_for(name)
        dir = File.join(@project_path, "tools", name)
        cfg = load_config
        req = (cfg.dig("tool_protocol", "required_files") || [])
        missing = req.reject { |f| File.exist?(File.join(dir, f)) }
        return { state: "draft", reason: "missing: #{missing.join(', ')}" } unless missing.empty?
        { state: "ready" }
      end

      def ensure_active(name)
        dir = File.join(@project_path, "tools", name)
        manifest = read_manifest(dir)
        test_entry = manifest["test"] || "test.py"
        runtime = manifest["runtime"] || "python3"
        test_path = File.join(dir, test_entry)
        return { ok: false, advice: "missing test: #{test_entry}" } unless File.exist?(test_path)
        out, err, status = Open3.capture3(runtime, test_path, chdir: @project_path)
        return { ok: true, out: out } if status.success?
        { ok: false, advice: build_advice(name, err.empty? ? out : err) }
      end

      def build_advice(name, trace)
        lines = trace.to_s.split("\n").last(20).join("\n")
        "Tool '#{name}' test failed. Fix logic.py or manifest.json. Traceback:\n#{lines}"
      end

      private
        def load_config
          begin
            require "yaml"
            path = File.join(@project_path, "config", "config.yml")
            File.exist?(path) ? YAML.load_file(path) : {}
          rescue StandardError
            {}
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
    end
  end
end

