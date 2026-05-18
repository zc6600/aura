module Aura
  module Context
    class LSPProvider
      def initialize(project_path, lsp_manager)
        @project_path = project_path
        @lsp_manager = lsp_manager
      end

      def provide
        return "" unless @lsp_manager
        diagnostics = @lsp_manager.get_diagnostics
        return "" if diagnostics.empty?

        section = ["# CODE HEALTH (LSP Diagnostics)"]
        
        error_files = []
        diagnostics.each do |uri, diags|
          next if diags.empty?
          
          rel_path = uri.sub(/^file:\/\/#{Regexp.escape(@project_path)}\//, "")
          errors = diags.select { |d| d["severity"] == 1 }
          warnings = diags.select { |d| d["severity"] == 2 }
          
          if errors.any? || warnings.any?
            error_files << "- #{rel_path}: #{errors.size} errors, #{warnings.size} warnings"
            
            # Show top 3 errors for context
            errors.first(3).each do |err|
              line = err.dig("range", "start", "line") + 1
              msg = err["message"]
              error_files << "  [L#{line}] Error: #{msg}"
            end
          end
        end

        return "" if error_files.empty?
        
        section << error_files.join("\n")
        section.join("\n\n")
      end
    end
  end
end
