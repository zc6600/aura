# frozen_string_literal: true

require "aura/ext/lsp/client"

module Aura
  module LSP
    class Manager
      def initialize(project_path)
        @project_path = File.expand_path(project_path)
        @clients = {}
        @diagnostics = {}
        @lock = Mutex.new
      end

      def client_for(language)
        @lock.synchronize do
          @clients[language] ||= start_client(language)
        end
      end

      def get_diagnostics(file_path = nil)
        @lock.synchronize do
          if file_path
            uri = "file://#{File.expand_path(file_path)}"
            @diagnostics[uri] || []
          else
            @diagnostics
          end
        end
      end

      def stop_all
        @lock.synchronize do
          @clients.each_value { |c| c&.stop }
          @clients.clear
        end
      end

      private

      def start_client(language)
        config = lsp_configs[language.to_s]
        return nil unless config

        client = Aura::LSP::Client.new(config[:command], config[:args], config[:env] || {})
        client.on_notification("textDocument/publishDiagnostics") do |params|
          update_diagnostics(params)
        end

        client.initialize_server(@project_path)
        client
      end

      def lsp_configs
        {
          "ruby" => {
            "command" => "solargraph",
            "args" => ["stdio"],
            "env" => { "PATH" => ENV["PATH"] }
          },
          "python" => {
            "command" => "pyright-langserver",
            "args" => ["--stdio"],
            "env" => { "PATH" => ENV["PATH"] }
          }
        }
      end

      def update_diagnostics(params)
        uri = params["uri"]
        diags = params["diagnostics"] || []
        @lock.synchronize do
          @diagnostics[uri] = diags
        end
      end
    end
  end
end
