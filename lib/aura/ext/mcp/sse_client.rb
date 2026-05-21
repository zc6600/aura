require "json"
require "net/http"
require "uri"
require "thread"

module Aura
  module MCP
    class SSEClient
      def initialize(url, headers = {}, timeout: 30)
        @url = URI.parse(url)
        @headers = headers || {}
        @timeout = timeout || 30
        @next_id = 1
        @queue = Queue.new
        @initialized = false
        @http = nil
        @response_queues = {}
        @lock = Mutex.new
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
        post_message(payload)
        true
      end

      def close
        begin
          # Signal thread to stop
          @running = false
          
          # Wait for thread to finish gracefully
          if @thread && @thread.alive?
            @thread.join(2) rescue nil
            @thread.kill if @thread && @thread.alive?
          end
          
          # Close HTTP connection
          @http&.finish if @http&.active?
        rescue StandardError
          nil
        ensure
          @thread = nil
          @http = nil
        end
      end

      private
        def ensure_started
          return if @thread && @thread.alive?
          @running = true
          @thread = Thread.new { listen_loop }
          # Wait a bit for the connection to establish
          sleep 0.5 until @http && @http.active? || !@thread.alive?
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
          
          q = Queue.new
          @lock.synchronize { @response_queues[id.to_s] = q }
          
          post_message(payload)
          
          begin
            Timeout.timeout(@timeout) { q.pop }
          ensure
            @lock.synchronize { @response_queues.delete(id.to_s) }
          end
        rescue Timeout::Error
          { "error" => { "message" => "mcp sse timeout" } }
        rescue StandardError => e
          { "error" => { "message" => e.message } }
        end

        def post_message(payload)
          # In MCP SSE, the client sends POST requests to the server's message endpoint
          # The initialize response typically contains the endpoint to POST to, 
          # but for simplicity, many servers use the same URL or a relative path.
          # Here we assume the server accepts POSTs at the same URL (simplified).
          req = Net::HTTP::Post.new(@url.path)
          @headers.each { |k, v| req[k] = v }
          req.body = JSON.generate(payload)
          req["Content-Type"] = "application/json"
          
          Net::HTTP.start(@url.host, @url.port, use_ssl: @url.scheme == 'https') do |http|
            http.request(req)
          end
        rescue StandardError
          nil
        end

        def listen_loop
          Net::HTTP.start(@url.host, @url.port, use_ssl: @url.scheme == 'https') do |http|
            @http = http
            req = Net::HTTP::Get.new(@url.path)
            @headers.each { |k, v| req[k] = v }
            req["Accept"] = "text/event-stream"
            
            http.request(req) do |response|
              buffer = ""
              response.read_body do |chunk|
                break unless @running  # Check running flag
                buffer << chunk
                while (line = buffer.slice!(/.*\n/))
                  break unless @running  # Check running flag
                  handle_sse_line(line.strip)
                end
              end
            end
          end
        rescue StandardError => e
          # Connection closed or error
        end

        def handle_sse_line(line)
          return if line.empty?
          if line.start_with?("data:")
            data = line["data:".length..-1].strip
            begin
              msg = JSON.parse(data)
              handle_message(msg)
            rescue StandardError
            end
          end
        end

        def handle_message(msg)
          return unless msg.is_a?(Hash) && msg["id"]
          id = msg["id"].to_s
          q = @lock.synchronize { @response_queues[id] }
          q.push(msg) if q
        end
    end
  end
end
