require "json"
require "open3"
require "timeout"
require "thread"

module Aura
  module LSP
    class Client
      attr_reader :server_capabilities

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
        @handlers = {}
        @notification_handlers = {}
        @lock = Mutex.new
        @initialized = false
        @server_capabilities = {}
      end

      def start
        return if @stdin
        @stdin, @stdout, @stderr, @wait_thr = Open3.popen3(@env, @command, *@args)
        @reader_thread = Thread.new { listen_loop }
      end

      def stop
        @stdin&.close
        @stdout&.close
        @stderr&.close
        @wait_thr&.kill
        @reader_thread&.kill
      rescue StandardError
        nil
      end

      def initialize_server(root_path)
        start
        resp = request("initialize", {
          "processId" => Process.pid,
          "rootPath" => root_path,
          "rootUri" => "file://#{root_path}",
          "capabilities" => client_capabilities,
          "initializationOptions" => {}
        })
        
        if resp && resp["result"]
          @server_capabilities = resp["result"]["capabilities"]
          notify("initialized", {})
          @initialized = true
        end
        resp
      end

      def request(method, params = nil)
        id = @next_id
        @next_id += 1
        
        q = Queue.new
        @lock.synchronize { @handlers[id.to_s] = q }
        
        payload = { "jsonrpc" => "2.0", "id" => id, "method" => method }
        payload["params"] = params if params
        
        write_message(payload)
        
        begin
          Timeout.timeout(@timeout) { q.pop }
        ensure
          @lock.synchronize { @handlers.delete(id.to_s) }
        end
      rescue Timeout::Error
        { "error" => { "message" => "lsp request timeout: #{method}" } }
      rescue StandardError => e
        { "error" => { "message" => e.message } }
      end

      def notify(method, params = nil)
        payload = { "jsonrpc" => "2.0", "method" => method }
        payload["params"] = params if params
        write_message(payload)
      end

      def on_notification(method, &block)
        @lock.synchronize { @notification_handlers[method] = block }
      end

      private
        def client_capabilities
          {
            "textDocument" => {
              "synchronization" => { "dynamicRegistration" => true, "didSave" => true },
              "publishDiagnostics" => { "relatedInformation" => true }
            },
            "workspace" => { "configuration" => true }
          }
        end

        def write_message(payload)
          body = JSON.generate(payload)
          @stdin.write("Content-Length: #{body.bytesize}\r\n\r\n#{body}")
          @stdin.flush
        rescue StandardError
          nil
        end

        def listen_loop
          @stdout.binmode
          loop do
            begin
              line = @stdout.gets("\r\n")
              break unless line
              if line =~ /Content-Length: (\d+)/
                length = $1.to_i
                @stdout.gets("\r\n") # skip \r\n
                body = @stdout.read(length)
                handle_message(JSON.parse(body))
              end
            rescue EOFError
              break
            rescue StandardError => e
              break
            end
          end
        end

        def handle_message(msg)
          if msg["id"]
            # Response
            q = @lock.synchronize { @handlers[msg["id"].to_s] }
            q.push(msg) if q
          elsif msg["method"]
            # Notification or Request from server
            handler = @lock.synchronize { @notification_handlers[msg["method"]] }
            handler.call(msg["params"]) if handler
          end
        end
    end
  end
end
