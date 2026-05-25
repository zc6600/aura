# frozen_string_literal: true

require "socket"
require "sqlite3"
require "open3"
require "json"
require "yaml"
require "uri"
require_relative "thread_pool"
require_relative "connection_pool"

module Aura
  module CLI
    module Shell
      # Optimized HTTP server for Aura web dashboard
      # Features: Thread pool, connection pooling, SSE streaming, session history
      class WebServer
        def initialize(project_path, port:, host:)
          @project_path = File.expand_path(project_path)
          @port = port.to_i
          @host = host.to_s
          @running = true
          @env_path = Aura::PathResolver.environment_path(@project_path)
          @db_path = Aura::PathResolver.session_db_path(@project_path)
          @project_name = extract_project_name
          @thread_pool = ThreadPool.new(max_threads: 10)
          @db_pool = ConnectionPool.new(size: 5) { SQLite3::Database.new(@db_path) }
        end

        def start
          # Setup signal handlers for graceful shutdown
          setup_signal_handlers

          @server = TCPServer.new(@host, @port)
          puts "Aura Web listening at http://#{@host}:#{@port}/"

          while @running
            begin
              socket = @server.accept
              @thread_pool.post { handle_request(socket) }
            rescue IOError, Errno::EBADF
              break
            end
          end

          cleanup
        end

        def stop
          @running = false
          begin
            @server.close if @server && !@server.closed?
          rescue StandardError
            nil
          end
        end

        def cleanup
          puts "\nShutting down Aura Web server..."
          begin
            @server.close unless @server.closed?
          rescue StandardError
            nil
          end
          @thread_pool.shutdown
          @db_pool.close
          puts "Server stopped."
        end

        def setup_signal_handlers
          # Handle SIGINT (Ctrl+C)
          Signal.trap("INT") do
            puts "\n\e[33mReceived SIGINT. Shutting down gracefully...\e[0m"
            stop
          end

          # Handle SIGTERM
          Signal.trap("TERM") do
            puts "\n\e[33mReceived SIGTERM. Shutting down gracefully...\e[0m"
            stop
          end
        end

        private

        def extract_project_name
          cfg = File.join(@env_path, "config", "config.yml")
          name = File.basename(@project_path)
          return name unless File.exist?(cfg)

          begin
            data = YAML.load_file(cfg)
            data["project_name"] || name
          rescue StandardError
            name
          end
        end

        def parse_query_string(query_string)
          return {} unless query_string

          params = {}
          query_string.split("&").each do |pair|
            key, value = pair.split("=", 2)
            params[URI.decode_www_form_component(key.to_s)] = URI.decode_www_form_component(value.to_s) if key
          end
          params
        end

        def handle_request(socket)
          # Store socket in thread-local storage for SSE handler
          Thread.current[:socket] = socket

          req_line = socket.gets || ""
          return if req_line.strip.empty?

          parts = req_line.split
          method = parts[0] || "GET"
          path = parts[1] || "/"
          _http_version = parts[2]

          path, query_string = path.split("?", 2)
          params = parse_query_string(query_string)

          headers = {}
          loop do
            line = socket.gets
            break if line.nil? || line.strip.empty?

            key, value = line.split(":", 2)
            headers[key.to_s.strip.downcase] = value.to_s.strip if key && value
          end

          # Read body for POST/PUT requests (reserved for future use)
          _body = ""
          if %w[POST PUT].include?(method) && headers["content-length"]
            content_length = headers["content-length"].to_i
            _body = socket.read(content_length) if content_length.positive?
          end

          begin
            log_request(method, path)

            response = route_request(method, path, params)
            socket.write(response) if response

            log_response(path, 200)
          rescue StandardError => e
            log_error(path, e)
            error_response = build_error_response(e.message)
            socket.write(error_response)
          ensure
            socket.close unless path == "/sse"
          end
        end

        def route_request(method, path, _params)
          return build_cors_response if method == "OPTIONS"

          case path
          when "/events"
            build_response(200, "application/json", events_json)
          when "/diff"
            build_response(200, "application/json", diff_json)
          when "/sse"
            handle_sse_direct
            nil
          when "/shutdown"
            Thread.new do
              sleep 0.2
              stop
            end
            build_response(200, "text/plain", "shutting down")
          when "/api/sessions"
            build_response(200, "application/json", sessions_json)
          when %r{/api/sessions/([^/]+)}
            session_id = path.match(%r{/api/sessions/([^/]+)})[1]
            build_response(200, "application/json", session_json(session_id))
          else
            build_response(200, "text/html; charset=utf-8", build_dashboard_html)
          end
        end

        def build_cors_response
          headers = {
            "Access-Control-Allow-Origin" => "*",
            "Access-Control-Allow-Methods" => "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers" => "Content-Type, Authorization",
            "Access-Control-Max-Age" => "86400"
          }
          build_response(200, "text/plain", "", headers)
        end

        def build_response(status, content_type, body, extra_headers = {})
          status_text = status == 200 ? "200 OK" : "#{status} Error"

          cors_headers = {
            "Access-Control-Allow-Origin" => "*",
            "Access-Control-Allow-Methods" => "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers" => "Content-Type"
          }

          all_headers = cors_headers.merge(extra_headers)
          header_str = all_headers.map { |k, v| "#{k}: #{v}" }.join("\r\n")

          "HTTP/1.1 #{status_text}\r\nContent-Type: #{content_type}\r\n#{header_str}\r\nContent-Length: #{body.bytesize}\r\n\r\n#{body}"
        end

        def build_error_response(message)
          error_body = { error: message, timestamp: Time.now.to_s }.to_json
          build_response(500, "application/json", error_body)
        end

        def log_request(method, path)
          puts "[#{Time.now.strftime('%H:%M:%S')}] #{method} #{path}"
        end

        def log_response(path, status)
          puts "[#{Time.now.strftime('%H:%M:%S')}] #{path} -> #{status}"
        end

        def log_error(path, error)
          warn "[#{Time.now.strftime('%H:%M:%S')}] ERROR #{path}: #{error.message}"
        end

        def events_json
          body = ""
          if File.exist?(@db_path)
            @db_pool.with do |db|
              rows = db.execute("SELECT payload FROM events ORDER BY id DESC LIMIT 50")
              lines = rows.map { |r| r[0].to_s }
              body = lines.reverse.join("\n")
            end
          end
          { tail: body }.to_json
        rescue StandardError => e
          { tail: "error: #{e.message}" }.to_json
        end

        def diff_json
          shadow_path = File.join(@env_path, "shadow")
          diff_body = "No changes recorded in the shadow workspace yet."

          if File.directory?(File.join(shadow_path, ".git"))
            out, _err, status = Open3.capture3("git diff HEAD~1 HEAD", chdir: shadow_path)
            if status.success? && !out.to_s.strip.empty?
              diff_body = out
            else
              out_unstaged, _err, status_unstaged = Open3.capture3("git diff", chdir: shadow_path)
              diff_body = out_unstaged if status_unstaged.success? && !out_unstaged.to_s.strip.empty?
            end
          end
          { diff: diff_body }.to_json
        end

        def sessions_json
          sessions = []
          if File.exist?(@db_path)
            @db_pool.with do |db|
              rows = db.execute("SELECT DISTINCT phase FROM events WHERE phase IS NOT NULL AND phase != '' ORDER BY phase DESC LIMIT 20")
              sessions = rows.flatten
            end
          end
          { sessions: sessions }.to_json
        rescue StandardError => e
          { sessions: [], error: e.message }.to_json
        end

        def session_json(session_id)
          events = []
          if File.exist?(@db_path)
            @db_pool.with do |db|
              rows = db.execute("SELECT payload FROM events WHERE phase = ? ORDER BY id ASC", [session_id])
              events = rows.flatten.map do |r|
                JSON.parse(r.to_s)
              rescue StandardError
                r.to_s
              end
            end
          end
          { session_id: session_id, events: events }.to_json
        rescue StandardError => e
          { session_id: session_id, events: [], error: e.message }.to_json
        end

        def handle_sse_direct
          socket = Thread.current[:socket]
          return unless socket

          begin
            socket.write("HTTP/1.1 200 OK\r\n" \
                         "Content-Type: text/event-stream\r\n" \
                         "Cache-Control: no-cache\r\n" \
                         "Connection: keep-alive\r\n" \
                         "Access-Control-Allow-Origin: *\r\n" \
                         "\r\n")
            socket.flush
            last_id = 0

            loop do
              begin
                if File.exist?(@db_path)
                  @db_pool.with do |db|
                    rows = db.execute("SELECT id, payload FROM events WHERE id > ? ORDER BY id ASC", [last_id])
                    rows.each do |row|
                      id, payload = row
                      socket.write("data: #{payload}\r\n\r\n")
                      socket.flush
                      last_id = id.to_i
                    end
                  end
                end
              rescue StandardError => e
                socket.write("event: error\r\ndata: #{e.message}\r\n\r\n")
                socket.flush
              end

              sleep 0.5
              break unless @running
            end
          rescue IOError, Errno::EPIPE, Errno::ECONNRESET
            # Client disconnected - this is normal for SSE
          ensure
            # Clear thread-local storage
            Thread.current[:socket] = nil
          end
        end

        def build_dashboard_html
          <<~HTML
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Aura OS - Dashboard</title>
              <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
              <style>
                :root {
                  --bg-primary: #0a0a10;
                  --bg-secondary: rgba(20, 20, 32, 0.7);
                  --accent: linear-gradient(135deg, #00f2fe 0%, #4facfe 100%);
                  --border-color: rgba(255, 255, 255, 0.08);
                  --text-main: #f4f4f7;
                  --text-muted: #a1a1aa;
                }
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body {
                  background: radial-gradient(circle at 50% 0%, #16162a 0%, var(--bg-primary) 70%);
                  color: var(--text-main);
                  font-family: 'Outfit', sans-serif;
                  min-height: 100vh;
                  display: flex;
                  flex-direction: column;
                }
                header {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  padding: 20px 40px;
                  background: rgba(10, 10, 16, 0.5);
                  backdrop-filter: blur(12px);
                  border-bottom: 1px solid var(--border-color);
                }
                .logo-section h1 {
                  font-size: 24px;
                  font-weight: 700;
                  background: var(--accent);
                  -webkit-background-clip: text;
                  -webkit-text-fill-color: transparent;
                  letter-spacing: -0.5px;
                }
                .project-badge {
                  background: rgba(255, 255, 255, 0.06);
                  padding: 6px 14px;
                  border-radius: 99px;
                  font-size: 14px;
                  border: 1px solid var(--border-color);
                  display: flex;
                  align-items: center;
                  gap: 8px;
                }
                .pulse-dot {
                  width: 8px;
                  height: 8px;
                  background: #10b981;
                  border-radius: 50%;
                  box-shadow: 0 0 8px #10b981;
                  animation: pulse 1.5s infinite;
                }
                @keyframes pulse {
                  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
                  70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
                  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
                }
                .dashboard-container {
                  display: grid;
                  grid-template-columns: 1fr 1fr;
                  gap: 24px;
                  padding: 30px 40px;
                  flex: 1;
                }
                .panel {
                  background: var(--bg-secondary);
                  backdrop-filter: blur(16px);
                  border: 1px solid var(--border-color);
                  border-radius: 16px;
                  display: flex;
                  flex-direction: column;
                  overflow: hidden;
                  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                }
                .panel-header {
                  padding: 16px 24px;
                  background: rgba(255, 255, 255, 0.02);
                  border-bottom: 1px solid var(--border-color);
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                }
                .panel-title {
                  font-size: 16px;
                  font-weight: 600;
                  color: var(--text-main);
                }
                .panel-actions button {
                  background: rgba(255, 255, 255, 0.08);
                  border: 1px solid var(--border-color);
                  color: var(--text-main);
                  padding: 6px 12px;
                  border-radius: 6px;
                  cursor: pointer;
                  font-family: inherit;
                  font-size: 13px;
                  transition: all 0.2s;
                }
                .panel-actions button:hover {
                  background: rgba(255, 255, 255, 0.15);
                  border-color: rgba(255, 255, 255, 0.2);
                }
                .panel-body {
                  flex: 1;
                  overflow: auto;
                  padding: 20px;
                  font-family: 'JetBrains Mono', monospace;
                  font-size: 14px;
                  line-height: 1.6;
                }
                #log-container {
                  white-space: pre-wrap;
                  color: #d1d5db;
                }
                .diff-line {
                  display: block;
                  padding: 2px 8px;
                  border-radius: 3px;
                }
                .diff-line.add {
                  background: rgba(16, 185, 129, 0.15);
                  color: #34d399;
                  border-left: 3px solid #10b981;
                }
                .diff-line.del {
                  background: rgba(239, 68, 68, 0.15);
                  color: #f87171;
                  border-left: 3px solid #ef4444;
                }
                .diff-line.meta {
                  color: #818cf8;
                  font-weight: 500;
                }
                footer {
                  text-align: center;
                  padding: 20px;
                  font-size: 12px;
                  color: var(--text-muted);
                  border-top: 1px solid var(--border-color);
                }
                .session-selector {
                  margin-bottom: 12px;
                }
                .session-selector select {
                  background: rgba(255, 255, 255, 0.08);
                  border: 1px solid var(--border-color);
                  color: var(--text-main);
                  padding: 6px 12px;
                  border-radius: 6px;
                  font-family: inherit;
                }
              </style>
            </head>
            <body>
              <header>
                <div class="logo-section">
                  <h1>Aura OS</h1>
                </div>
                <div class="project-badge">
                  <div class="pulse-dot"></div>
                  <span>Workspace: <strong>#{@project_name}</strong></span>
                </div>
              </header>

              <main class="dashboard-container">
                <div class="panel">
                  <div class="panel-header">
                    <div class="panel-title">Live Events & Logs</div>
                    <div class="panel-actions">
                      <button onclick="loadSessions()">Load Sessions</button>
                    </div>
                  </div>
                  <div class="panel-body">
                    <div class="session-selector">
                      <select id="session-select" onchange="loadSessionEvents()">
                        <option value="">Live Stream</option>
                      </select>
                    </div>
                    <div id="log-container">Starting log subscription...</div>
                  </div>
                </div>

                <div class="panel">
                  <div class="panel-header">
                    <div class="panel-title">Shadow Workspace Diff</div>
                    <div class="panel-actions">
                      <button onclick="fetchDiff()">Refresh Diff</button>
                    </div>
                  </div>
                  <div class="panel-body" id="diff-container" style="white-space: pre-wrap;">Loading latest shadow workspace diff...</div>
                </div>
              </main>

              <footer>
                Aura OS &copy; 2026. All rights reserved.
              </footer>

              <script>
                var s = new EventSource('/sse');
                var logContainer = document.getElementById('log-container');
                var sessionSelect = document.getElementById('session-select');

                s.onmessage = function(e) {
                  if (sessionSelect.value === '') {
                    if (logContainer.textContent.startsWith('Starting log')) {
                      logContainer.textContent = '';
                    }
            #{'  '}
                    var data = e.data;
                    try {
                      var parsed = JSON.parse(data);
                      if (parsed.message) {
                        data = parsed.message;
                      }
                    } catch(err) {}

                    logContainer.textContent += data + '\\n';
                    logContainer.scrollTop = logContainer.scrollHeight;
            #{'  '}
                    fetchDiff();
                  }
                };

                function fetchDiff() {
                  fetch('/diff')
                    .then(res => res.json())
                    .then(data => {
                      var diffContainer = document.getElementById('diff-container');
                      diffContainer.innerHTML = '';

                      if (!data.diff) {
                        diffContainer.textContent = 'No diffs found.';
                        return;
                      }

                      var lines = data.diff.split('\\n');
                      lines.forEach(line => {
                        var div = document.createElement('div');
                        div.className = 'diff-line';
                        if (line.startsWith('+') && !line.startsWith('+++')) {
                          div.className += ' add';
                        } else if (line.startsWith('-') && !line.startsWith('---')) {
                          div.className += ' del';
                        } else if (line.startsWith('@@') || line.startsWith('diff')) {
                          div.className += ' meta';
                        }
                        div.textContent = line;
                        diffContainer.appendChild(div);
                      });
                    })
                    .catch(err => {
                      document.getElementById('diff-container').textContent = 'Error loading diff: ' + err.message;
                    });
                }

                function loadSessions() {
                  fetch('/api/sessions')
                    .then(res => res.json())
                    .then(data => {
                      sessionSelect.innerHTML = '<option value="">Live Stream</option>';
                      data.sessions.forEach(function(id) {
                        var option = document.createElement('option');
                        option.value = id;
                        option.textContent = 'Session ' + id;
                        sessionSelect.appendChild(option);
                      });
                    });
                }

                function loadSessionEvents() {
                  var sessionId = sessionSelect.value;
                  if (!sessionId) {
                    logContainer.textContent = 'Starting log subscription...';
                    return;
                  }

                  fetch('/api/sessions/' + sessionId)
                    .then(res => res.json())
                    .then(data => {
                      logContainer.textContent = '';
                      data.events.forEach(function(evt) {
                        if (typeof evt === 'object' && evt.message) {
                          logContainer.textContent += evt.message + '\\n';
                        } else {
                          logContainer.textContent += String(evt) + '\\n';
                        }
                      });
                      logContainer.scrollTop = logContainer.scrollHeight;
                    });
                }

                fetchDiff();
              </script>
            </body>
            </html>
          HTML
        end
      end
    end
  end
end
