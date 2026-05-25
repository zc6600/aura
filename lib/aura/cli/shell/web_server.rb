# frozen_string_literal: true

require "socket"
require "sqlite3"
require "open3"
require "json"
require "yaml"

module Aura
  module CLI
    module Shell
      # Lightweight HTTP server for Aura web dashboard
      # Handles SSE streaming, event retrieval, and shadow workspace diff visualization
      class WebServer
        def initialize(project_path, port:, host:)
          @project_path = File.expand_path(project_path)
          @port = port.to_i
          @host = host.to_s
          @running = true
          @env_path = Aura::PathResolver.environment_path(@project_path)
          @db_path = Aura::PathResolver.session_db_path(@project_path)
          @project_name = extract_project_name
        end

        def start
          server = TCPServer.new(@host, @port)
          puts "Aura Web listening at http://#{@host}:#{@port}/"

          while @running
            socket = server.accept
            handle_request(socket)
          end

          server.close
        end

        def stop
          @running = false
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

        def handle_request(socket)
          req_line = socket.gets || ""
          path = req_line.split(" ")[1] || "/"

          begin
            case path
            when "/events"
              handle_events(socket)
            when "/diff"
              handle_diff(socket)
            when "/sse"
              handle_sse(socket)
            when "/shutdown"
              handle_shutdown(socket)
            else
              handle_dashboard(socket)
            end
          ensure
            socket.close unless path == "/sse"
          end
        end

        def handle_events(socket)
          body = ""
          if File.exist?(@db_path)
            db = SQLite3::Database.new(@db_path)
            rows = db.execute("SELECT payload FROM events ORDER BY id DESC LIMIT 3")
            lines = rows.map { |r| r[0].to_s }
            body = lines.reverse.join("\n")
            db.close
          end

          payload = { tail: body }.to_json
          send_response(socket, 200, "application/json", payload)
        rescue StandardError => e
          send_response(socket, 200, "application/json", { tail: "error: #{e.message}" }.to_json)
        end

        def handle_diff(socket)
          shadow_path = File.join(@env_path, "shadow")
          diff_body = "No changes recorded in the shadow workspace yet. Aura files will show up here after agent modifications."

          if File.directory?(File.join(shadow_path, ".git"))
            out, _err, status = Open3.capture3("git diff HEAD~1 HEAD", chdir: shadow_path)
            if status.success? && !out.to_s.strip.empty?
              diff_body = out
            else
              out_unstaged, _err, status_unstaged = Open3.capture3("git diff", chdir: shadow_path)
              diff_body = out_unstaged if status_unstaged.success? && !out_unstaged.to_s.strip.empty?
            end
          end

          payload = { diff: diff_body }.to_json
          send_response(socket, 200, "application/json", payload)
        end

        def handle_sse(socket)
          headers = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n"
          socket.write(headers)
          last_id = 0

          loop do
            begin
              if File.exist?(@db_path)
                db = SQLite3::Database.new(@db_path)
                rows = db.execute("SELECT id, payload FROM events WHERE id > ? ORDER BY id ASC", [last_id])
                rows.each do |row|
                  id, payload = row
                  socket.write("data: #{payload}\r\n\r\n")
                  socket.flush
                  last_id = id.to_i
                end
                db.close
              else
                socket.write("data: {\"warning\":\"db not found\"}\r\n\r\n")
                socket.flush
              end
            rescue StandardError => e
              socket.write("event: error\r\ndata: #{e.message}\r\n\r\n")
              socket.flush
            end

            sleep 1
            break unless @running
          end
        end

        def handle_shutdown(socket)
          send_response(socket, 200, "text/plain", "shutting down")
          @running = false
        end

        def handle_dashboard(socket)
          html = build_dashboard_html
          send_response(socket, 200, "text/html; charset=utf-8", html)
        end

        def send_response(socket, status, content_type, body)
          status_text = status == 200 ? "200 OK" : "#{status} Error"
          resp = "HTTP/1.1 #{status_text}\r\nContent-Type: #{content_type}\r\nContent-Length: #{body.bytesize}\r\n\r\n#{body}"
          socket.write(resp)
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
                <!-- Left: Log Stream -->
                <div class="panel">
                  <div class="panel-header">
                    <div class="panel-title">Live Events & Logs</div>
                  </div>
                  <div class="panel-body" id="log-container">Starting log subscription...</div>
                </div>

                <!-- Right: Shadow Workspace Diff -->
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
            #{'    '}
                s.onmessage = function(e) {
                  if (logContainer.textContent.startsWith('Starting log')) {
                    logContainer.textContent = '';
                  }
            #{'      '}
                  var data = e.data;
                  try {
                    var parsed = JSON.parse(data);
                    if (parsed.message) {
                      data = parsed.message;
                    }
                  } catch(err) {}

                  logContainer.textContent += data + '\\n';
                  logContainer.scrollTop = logContainer.scrollHeight;
            #{'      '}
                  // Auto fetch diff on new events
                  fetchDiff();
                };

                function fetchDiff() {
                  fetch('/diff')
                    .then(res => res.json())
                    .then(data => {
                      var diffContainer = document.getElementById('diff-container');
                      diffContainer.innerHTML = '';
            #{'          '}
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

                // Initial fetch
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
