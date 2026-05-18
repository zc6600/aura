require "json"

module Aura
  module Kernel
    module Tools
      class LSPDiagnostics
        def initialize(lsp_manager)
          @lsp_manager = lsp_manager
        end

        def info
          {
            "name" => "lsp_diagnostics",
            "description" => "Get detailed LSP diagnostics for a specific file or the entire project. Use this when you need to fix syntax errors or type issues identified in the 'CODE HEALTH' section of your context.",
            "input_schema" => {
              "type" => "object",
              "properties" => {
                "file_path" => {
                  "type" => "string",
                  "description" => "Optional relative path to a specific file. If omitted, returns diagnostics for all tracked files."
                },
                "language" => {
                  "type" => "string",
                  "enum" => ["ruby", "python"],
                  "description" => "The language server to query. Defaults to 'ruby' for .rb files and 'python' for .py files."
                }
              }
            }
          }
        end

        def execute(args)
          file_path = args["file_path"]
          
          # Warm up the client if a specific language is requested or can be inferred
          lang = args["language"]
          if file_path && !lang
            ext = File.extname(file_path).downcase
            lang = "ruby" if ext == ".rb"
            lang = "python" if ext == ".py"
          end
          
          @lsp_manager.client_for(lang) if lang
          
          # Wait a bit for server to process (mimicking OpenCode's wait loop)
          sleep 0.5 if lang
          
          diags = @lsp_manager.get_diagnostics(file_path)
          
          if diags.empty?
            return { "status" => "ok", "content" => "No diagnostics found." }
          end

          { "status" => "ok", "content" => format_diagnostics(diags) }
        end

        private
          def format_diagnostics(diags)
            if diags.is_a?(Hash)
              # Project-wide
              diags.map do |uri, file_diags|
                next if file_diags.empty?
                "=== #{uri} ===\n#{format_file_diags(file_diags)}"
              end.compact.join("\n\n")
            else
              # Single file
              format_file_diags(diags)
            end
          end

          def format_file_diags(diags)
            diags.map do |d|
              severity = case d["severity"]
                         when 1 then "Error"
                         when 2 then "Warning"
                         when 3 then "Information"
                         when 4 then "Hint"
                         else "Unknown"
                         end
              line = d.dig("range", "start", "line") + 1
              col = d.dig("range", "start", "character") + 1
              "[#{severity}] L#{line}:#{col} - #{d["message"]}"
            end.join("\n")
          end
      end
    end
  end
end
