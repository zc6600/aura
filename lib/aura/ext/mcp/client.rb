require "json"
require "open3"
require "timeout"

module Aura
  module MCP
    class StdioClient
      def initialize(command, args = [], env = {}, timeout: 30)
        @command = command
        @args = args || []
        @env = env || {}
        @timeout = timeout || 30
        @next_id = 1
        @stdin = nil
        @stdout = nil
        @stderr = nil
        @wait_thr = nil
        @initialized = false
      end

      def request(method, params = nil)
        ensure_started
        ensure_initialized
        request_raw(method, params)
      end

      def notify(method, params = nil)
        ensure_started
        payload = { "jsonrpc" => "2.0", "method" => method }
        payload["params"] = params if params
        write_message(payload)
        true
      end

      def close
        @stdin&.close
        @stdout&.close
        @stderr&.close
        @wait_thr&.kill
      rescue StandardError
        nil
      end

      private
        def ensure_started
          return if @stdin
          @stdin, @stdout, @stderr, @wait_thr = Open3.popen3(@env, @command, *@args)
        end

        def ensure_initialized
          return if @initialized
          version = defined?(Aura::VERSION) ? Aura::VERSION : "0.1.0"
          resp = request_raw("initialize", {
            "protocolVersion" => "2025-11-25",
            "capabilities" => {},
            "clientInfo" => { "name" => "aura", "version" => version }
          })
          notify("notifications/initialized", {}) if resp && resp["result"]
          @initialized = true
        end

        def request_raw(method, params = nil)
          id = @next_id
          @next_id += 1
          payload = { "jsonrpc" => "2.0", "id" => id, "method" => method }
          payload["params"] = params if params
          write_message(payload)
          read_response(id)
        end

        def write_message(payload)
          @stdin.write(JSON.generate(payload))
          @stdin.write("\n")
          @stdin.flush
        rescue StandardError
          nil
        end

        def read_response(id)
          Timeout.timeout(@timeout) do
            loop do
              line = @stdout.gets
              return { "error" => { "message" => "mcp server closed" } } if line.nil?
              line = line.strip
              next if line.empty?
              begin
                msg = JSON.parse(line)
              rescue StandardError
                next
              end
              next unless msg.is_a?(Hash)
              return msg if msg["id"].to_s == id.to_s
            end
          end
        rescue Timeout::Error
          { "error" => { "message" => "mcp timeout" } }
        rescue StandardError => e
          { "error" => { "message" => e.message } }
        end
    end
  end
end
