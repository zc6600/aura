# frozen_string_literal: true

require "thor"
require "fileutils"
require "open3"
require "json"
require "yaml"
require "shellwords"

# Load extracted command classes
require "aura/cli/commands/new_command"
require "aura/cli/commands/config_command"
require "aura/cli/commands/doctor_command"
require "aura/cli/commands/info_command"
require "aura/cli/commands/project_command"
require "aura/cli/commands/version_command"
require "aura/cli/commands/completion_command"
require "aura/cli/commands/branch_command"
require "aura/cli/commands/tools_command"
require "aura/cli/commands/kernel_command"
require "aura/cli/commands/shell_command"
require "aura/cli/commands/skills_command"
require "aura/cli/commands/hints_command"
require "aura/cli/commands/session_command"
require "aura/cli/commands/update_command"
require "aura/cli/commands/template_command"

module Aura
  # Dynamically read version from gemspec if available, otherwise use fallback
  VERSION = begin
    gem_spec = Gem::Specification.find_by_name("aura")
    gem_spec.version.to_s
  rescue Gem::MissingSpecError
    "0.1.0"  # Fallback for development from source
  end
  
  module Commands
    class ApplicationCommand < Thor
      map "h" => "hints"
      map "t" => "tools"
      map "s" => "skill"
      map "k" => "kernel"
      map "c" => "chat"
      map "v" => "version"

      def self.exit_on_failure?
        true
      end

      # Delegate to extracted commands
      desc "new [PATH]", "Initialize an Aura environment at the specified path"
      def new(target_path = ".")
        NewCommand.new.invoke(:new, [target_path], {})
      end

      desc "version", "Show Aura version"
      def version
        VersionCommand.new.invoke(:version, [], {})
      end

      desc "completion [SHELL]", "Generate shell autocompletion script (bash or zsh)"
      def completion(shell = nil)
        CompletionCommand.new.invoke(:completion, [shell], {})
      end

      desc "doctor", "Run environment checks"
      def doctor
        DoctorCommand.new.invoke(:doctor, [], {})
      end

      desc "info", "Display comprehensive system and workspace information"
      def info
        InfoCommand.new.invoke(:info, [], {})
      end

      desc "config [KEY] [VALUE]", "Read or write configuration settings"
      method_option :global, type: :boolean, aliases: "-g", desc: "Target the global template repository config"
      def config(key = nil, value = nil)
        ConfigCommand.new.invoke(:config, [key, value], options)
      end

      desc "list", "List all globally registered Aura projects"
      def list
        ProjectCommand.new.invoke(:list, [], {})
      end

      desc "delete PROJECT_NAME", "Unregister an Aura project and delete its .aura sandbox"
      def delete(project_name)
        ProjectCommand.new.invoke(:delete, [project_name], {})
      end

      desc "register PROJECT_NAME", "Register the current directory as an Aura project"
      def register(project_name)
        ProjectCommand.new.invoke(:register, [project_name], {})
      end

      desc "prune", "Remove all registered projects whose directories no longer exist"
      def prune
        ProjectCommand.new.invoke(:prune, [], {})
      end

      desc "branch [PROFILE_NAME]", "List, switch, or create customized agent profiles"
      def branch(profile_name = nil)
        BranchCommand.new.invoke(:branch, [profile_name], {})
      end

      desc "context [PROJECT_PATH]", "Compile and print project context"
      def context(project_path = nil)
        require "aura/memory"
        resolved_path = Aura::WorkspaceInitializer.resolve_project_path!(project_path)
        root = File.expand_path(resolved_path)
        env_path = Aura::PathResolver.environment_path(root)
        config = Aura::Memory::Config.new(store: { project_path: env_path })
        memory = Aura::Memory::Base.new(config: config)
        db = Aura::Memory::Adapters::CompatibilityAdapter.new(memory)
        out = Aura::Context.assemble(root, db)
        puts out
      end

      desc "tools SUBCOMMAND ...", "Tools management commands"
      subcommand "tools", Aura::Commands::ToolsCommand

      desc "kernel SUBCOMMAND ...", "Kernel commands"
      subcommand "kernel", Aura::Commands::KernelCommand

      desc "skill SUBCOMMAND ...", "Manage agent skills in the active workspace"
      subcommand "skill", Aura::Commands::SkillsCommand

      desc "hints SUBCOMMAND ...", "Manage context/magic hint injection configurations"
      subcommand "hints", Aura::Commands::HintsCommand

      desc "session SUBCOMMAND ...", "Manage conversation sessions"
      subcommand "session", Aura::Commands::SessionCommand

      desc "update SUBCOMMAND ...", "Update framework, templates, and sub-projects"
      subcommand "update", Aura::Commands::UpdateCommand

      desc "template SUBCOMMAND ...", "Template management and sync"
      subcommand "template", Aura::Commands::TemplateCommand

      desc "chat [PROJECT_PATH]", "Start an interactive Aura chat session"
      method_option :verbose, type: :boolean, aliases: "-v", desc: "Show detailed output"
      method_option :goal, type: :string, aliases: "-g", desc: "Autonomous goal to execute without interactive input (exits when complete)"
      method_option :non_interactive, type: :boolean, aliases: "--ni", default: false, desc: "Run non-interactively (requires --goal); final answer is printed to stdout"
      def chat(project_path = nil)
        resolved_path = Aura::WorkspaceInitializer.resolve_project_path!(project_path)
        Aura::Commands::ShellCommand.new.start(resolved_path, options)
      end

      desc "web [PROJECT_PATH]", "Start a lightweight Aura web server (events JSON & SSE)"
      method_option :port, type: :numeric, aliases: "-p", default: 9299, desc: "Port to bind"
      method_option :host, type: :string, aliases: "-h", default: "127.0.0.1", desc: "Host address"
      def web(project_path = nil)
        require "socket"
        require "sqlite3"
        resolved_path = Aura::WorkspaceInitializer.resolve_project_path!(project_path)
        root = File.expand_path(resolved_path)
        env_path = Aura::PathResolver.environment_path(root)
        
        require "aura/path_resolver"
        db_path = Aura::PathResolver.session_db_path(root)

        cfg = File.join(env_path, "config", "config.yml")
        project_name = File.basename(root)
        if File.exist?(cfg)
          begin
            data = YAML.load_file(cfg)
            project_name = data["project_name"] || project_name
          rescue StandardError
          end
        end

        port = (options[:port] || options["port"] || 9299).to_i
        host = (options[:host] || options["host"] || "127.0.0.1").to_s
        server = TCPServer.new(host, port)
        running = true
        puts "Aura Web listening at http://#{host}:#{port}/"
        while running
          socket = server.accept
          begin
            req_line = socket.gets || ""
            path = req_line.split(" ")[1] || "/"
            if path == "/events"
              body = ""
              begin
                if File.exist?(db_path)
                  db = SQLite3::Database.new(db_path)
                  rows = db.execute("SELECT payload FROM events ORDER BY id DESC LIMIT 3")
                  lines = rows.map { |r| r[0].to_s }
                  body = lines.reverse.join("\n")
                  db.close
                end
              rescue StandardError => e
                body = "error: #{e.message}"
              end
              payload = { tail: body }.to_json
              resp = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: #{payload.bytesize}\r\n\r\n#{payload}"
              socket.write(resp)
            elsif path == "/diff"
              shadow_path = File.join(env_path, "shadow")
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
              resp = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: #{payload.bytesize}\r\n\r\n#{payload}"
              socket.write(resp)
            elsif path == "/sse"
              socket.write "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n"
              last_id = 0
              loop do
                begin
                  if File.exist?(db_path)
                     db = SQLite3::Database.new(db_path)
                     rows = db.execute("SELECT id, payload FROM events WHERE id > ? ORDER BY id ASC", [last_id])
                     rows.each do |row|
                       id, payload = row
                       socket.write "data: #{payload}\r\n\r\n"
                       socket.flush
                       last_id = id.to_i
                     end
                     db.close
                  else
                     socket.write "data: {\"warning\":\"db not found\"}\r\n\r\n"
                     socket.flush
                  end
                rescue StandardError => e
                  socket.write "event: error\r\ndata: #{e.message}\r\n\r\n"
                  socket.flush
                end
                sleep 1
                break unless running
              end
            elsif path == "/shutdown"
              resp = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 14\r\n\r\nshutting down"
              socket.write(resp)
              running = false
            else
              html = <<~HTML
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
                      <span>Workspace: <strong>#{project_name}</strong></span>
                    </div>
                  </header>

                  <main class="dashboard-container">
                    <!-- Left: Log Stream -->
                    <div class="panel">
                      <div class="panel-header">
                        <div class="panel-title">Live Events & Logs</div>
                      </div>
                      <div class="panel-body" id="log-container">Starting log subscription...
                </div>
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
                    
                    s.onmessage = function(e) {
                      if (logContainer.textContent.startsWith('Starting log')) {
                        logContainer.textContent = '';
                      }
                      
                      var data = e.data;
                      try {
                        var parsed = JSON.parse(data);
                        if (parsed.message) {
                          data = parsed.message;
                        }
                      } catch(err) {}

                      logContainer.textContent += data + '\\n';
                      logContainer.scrollTop = logContainer.scrollHeight;
                      
                      // Auto fetch diff on new events
                      fetchDiff();
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

                    // Initial fetch
                    fetchDiff();
                  </script>
                </body>
                </html>
              HTML
              resp = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: #{html.bytesize}\r\n\r\n#{html}"
              socket.write(resp)
            end
          ensure
            socket.close unless path == "/sse"
          end
        end
        server.close
      end

      # --- Git-based Version Control Commands ---

      desc "add PATHS...", "Stage files inside the local Aura environment"
      def add(*paths)
        aura_dir = ensure_workspace!
        
        require "pathname"
        resolved_paths = paths.map do |p|
          abs_p = File.expand_path(p)
          if abs_p.start_with?(aura_dir)
            Pathname.new(abs_p).relative_path_from(Pathname.new(aura_dir)).to_s
          else
            p
          end
        end

        res = Aura::GlobalConfig.git_run(aura_dir, "add", *resolved_paths)
        if res[:success]
          puts "\e[32mSuccessfully staged changes inside .aura.\e[0m"
        else
          puts "\e[31mError staging changes:\n#{res[:stderr]}\e[0m"
        end
      end

      desc "commit", "Commit staged changes inside the local Aura environment"
      method_option :message, type: :string, aliases: "-m", required: true, desc: "Commit message"
      def commit
        aura_dir = ensure_workspace!
        msg = options[:message] || options["message"]
        res = Aura::GlobalConfig.git_run(aura_dir, "commit", "-m", msg.to_s)
        if res[:success]
          puts "\e[32mSuccessfully committed changes inside .aura:\e[0m"
          puts res[:stdout]
        else
          puts "\e[31mError committing changes:\n#{res[:stderr]}\e[0m"
        end
      end

      desc "sync", "Push local workspace changes back to the global template repository"
      def sync
        aura_dir = ensure_workspace!
        puts "Syncing changes back to the global repository (~/.aura/repo)..."
        res = Aura::GlobalConfig.git_run(aura_dir, "push", "origin", "main")
        if res[:success]
          puts "\e[32mSuccessfully synced local changes to global repo!\e[0m"
        else
          puts "\e[31mError syncing changes:\n#{res[:stderr]}\e[0m"
        end
      end

      desc "pull", "Pull new templates or updates from the global repository"
      def pull
        aura_dir = ensure_workspace!
        puts "Pulling updates from the global repository (~/.aura/repo)..."
        res = Aura::GlobalConfig.git_run(aura_dir, "pull", "origin", "main")
        if res[:success]
          puts "\e[32mSuccessfully pulled updates from global repo!\e[0m"
          puts res[:stdout]
        else
          puts "\e[31mError pulling updates:\n#{res[:stderr]}\e[0m"
        end
      end

      desc "status", "Show what files are modified or untracked inside .aura"
      def status
        aura_dir = ensure_workspace!
        res = Aura::GlobalConfig.git_run(aura_dir, "status")
        puts res[:stdout]
        puts res[:stderr] unless res[:stderr].empty?
      end

      desc "ask QUESTION", "Directly ask the LLM a question without any Aura OS context wrapping (retains conversation memory)"
      method_option :model, type: :string, desc: "Override model name"
      method_option :provider, type: :string, desc: "Override provider name (local, openai, openrouter)"
      method_option :system, type: :string, desc: "System prompt instructions"
      method_option :session, type: :string, aliases: "-s", default: "default", desc: "Session name for memory"
      method_option :clear, type: :boolean, aliases: "-c", default: false, desc: "Clear session memory before asking"
      def ask(question)
        require "aura/llm/client"
        require "aura/llm/env"
        
        # Load configuration (checking active .aura workspace config first, then global config)
        aura_dir = find_aura_dir
        cfg_path = if aura_dir
                     Aura::PathResolver.resolve_config_path(aura_dir)
                   else
                     Aura::PathResolver.resolve_config_path(Aura::GlobalConfig.repo_path)
                   end
        
        cfg = File.exist?(cfg_path) ? (YAML.load_file(cfg_path) || {}) : {}
        
        # Determine provider, api_base, model, temperature
        provider = options[:provider] || options["provider"] || cfg.dig("llm", "provider") || "local"
        api_base = cfg.dig("llm", "api_base")
        model = options[:model] || options["model"] || cfg.dig("llm", "model")
        temp = cfg.dig("llm", "temperature") || 0.7
        max_tokens = cfg.dig("llm", "max_tokens")
        
        # Load API keys: workspace .env first, then global sources (~/.aura/repo/.env, ~/.aura/.env)
        if aura_dir
          Aura::LLM::Env.load_from(File.dirname(aura_dir))
        else
          # Not inside a workspace: load cwd .env then global fallbacks
          Aura::LLM::Env.load_from(Dir.pwd)
        end
        api_key = Aura::LLM::Env.resolve_api_key(provider)
        
        # Resolve history session file
        state_dir = if aura_dir
                      File.join(aura_dir, "state")
                    else
                      File.join(Aura::GlobalConfig.repo_path, "state")
                    end
        sessions_dir = File.join(state_dir, "ask_sessions")
        session_name = options[:session] || options["session"] || "default"
        # Sanitize session name to prevent directory traversal
        session_name = session_name.to_s.gsub(/[^a-zA-Z0-9_\-]/, "")
        session_name = "default" if session_name.empty?
        history_file = File.join(sessions_dir, "#{session_name}.json")
        
        if options[:clear] || options["clear"]
          FileUtils.rm_f(history_file)
          puts "\e[33mMemory cleared for session '#{session_name}'.\e[0m"
        end
        
        history = []
        if File.exist?(history_file)
          begin
            history = JSON.parse(File.read(history_file))
          rescue StandardError
            # If invalid JSON, default to empty history
          end
        end
        
        client = Aura::LLM::Client.new(provider: provider, api_base: api_base, api_key: api_key, model: model)
        
        messages = []
        system_instruction = options[:system] || options["system"]
        
        # Append sliding window of last 10 messages (5 turns)
        limit = 10
        recent_history = history.last(limit)
        recent_history.each do |msg|
          role = msg["role"] || msg[:role]
          content = msg["content"] || msg[:content]
          messages << { role: role.to_s, content: content.to_s }
        end
        
        q_content = if system_instruction
          "System Instruction: #{system_instruction}\n\n#{question}"
        else
          question
        end
        messages << { role: "user", content: q_content }
        
        puts "\e[34m🤖 Connecting to #{provider} (#{model || 'default model'})...\e[0m"
        puts ""
        
        # Stream response
        response_text = +""
        begin
          client.complete_stream(messages, { temperature: temp, max_tokens: max_tokens }) do |delta|
            print delta
            response_text << delta
            $stdout.flush
          end
          puts ""
          
          # Save back to history if successfully completed and response is not empty
          if !response_text.strip.empty?
            history << { role: "user", content: question }
            history << { role: "assistant", content: response_text }
            # Limit history to 100 messages (50 turns) to prevent file bloat
            history = history.last(100)
            
            begin
              FileUtils.mkdir_p(sessions_dir)
              File.write(history_file, JSON.pretty_generate(history))
            rescue StandardError => e
              puts "\e[33m⚠️ Warning: Failed to save session history: #{e.message}\e[0m"
            end
          end
        rescue StandardError => e
          puts "\n\e[31m⛔️ Error calling LLM: #{e.message}\e[0m"
        end
      end

      desc "list", "List all globally registered Aura projects and their status"
      def list
        projects = Aura::ProjectRegistry.registered_projects
        if projects.empty?
          puts "No Aura projects registered yet. Run 'aura new <project_name>' to register a workspace."
          return
        end

        puts "Registered Aura Projects:"
        puts "-" * 80
        printf "%-20s %-45s %-15s\n", "Name", "Path", "Status"
        puts "-" * 80

        projects.each do |name, path|
          status = File.directory?(File.join(path, ".aura")) ? "\e[32mActive\e[0m" : "\e[31mMissing (.aura folder not found)\e[0m"
          printf "%-20s %-45s %-15s\n", name, path, status
        end
        puts "-" * 80
      end

      desc "delete PROJECT_NAME", "Unregister an Aura project and cleanly delete its local .aura sandbox"
      def delete(project_name)
        projects = Aura::ProjectRegistry.registered_projects
        path = projects[project_name.to_s]
        
        if path.nil?
          puts "\e[31m⛔️ Error: Project '#{project_name}' is not registered globally.\e[0m"
          exit 1
        end

        puts "⚠️ WARNING: You are about to delete project '#{project_name}'."
        puts "   - Registered Path: #{path}"
        
        hidden = File.join(path, ".aura")
        physical_exists = File.directory?(hidden)
        if physical_exists
          puts "   - Local environment (.aura/) will be physically deleted."
        else
          puts "   - Local environment (.aura/) does not exist physically (already deleted or moved)."
        end
        
        print "❓ Are you sure you want to proceed? (y/N): "
        $stdout.flush
        begin
          tty = File.open("/dev/tty", "r")
          confirm = tty.gets.strip
          tty.close
        rescue StandardError
          confirm = $stdin.gets&.strip || "n"
        end

        if confirm =~ /\A(y|yes)\z/i
          if physical_exists
            begin
              FileUtils.rm_rf(hidden)
              puts "\e[32mSuccessfully deleted physical sandbox at #{hidden}.\e[0m"
            rescue StandardError => e
              puts "\e[31mFailed to delete physical sandbox: #{e.message}\e[0m"
            end
          end
          
          if Aura::ProjectRegistry.unregister!(project_name)
            puts "\e[32mProject '#{project_name}' has been successfully unregistered globally.\e[0m"
          else
            puts "\e[31mFailed to unregister project '#{project_name}' from global projects registry.\e[0m"
          end
        else
          puts "Deletion cancelled."
        end
      end

      desc "register PROJECT_NAME", "Register the current directory as an active Aura project globally"
      def register(project_name)
        aura_dir = ensure_workspace!

        # Register in projects registry
        Aura::ProjectRegistry.register!(project_name, Dir.pwd)

        # Write project name to local config
        cfg_path = File.join(aura_dir, "config", "config.yml")
        begin
          cfg = File.exist?(cfg_path) ? (YAML.load_file(cfg_path) || {}) : {}
          cfg["project_name"] = project_name.to_s
          File.write(cfg_path, YAML.dump(cfg))
        rescue StandardError
        end

        puts "\e[32mSuccessfully registered workspace at #{Dir.pwd} as '#{project_name}'!\e[0m"
      end

      desc "prune", "Remove all registered projects whose physical directories no longer exist"
      def prune
        projects = Aura::ProjectRegistry.registered_projects
        if projects.empty?
          puts "No projects registered."
          return
        end

        pruned_count = 0
        projects.each do |name, path|
          unless File.directory?(File.join(path, ".aura"))
            Aura::ProjectRegistry.unregister!(name)
            puts "\e[33mPruned missing project '#{name}' (path: #{path})\e[0m"
            pruned_count += 1
          end
        end

        if pruned_count > 0
          puts "\e[32mSuccessfully pruned #{pruned_count} missing project(s)!\e[0m"
        else
          puts "No missing projects to prune."
        end
      end

      desc "branch [PROFILE_NAME]", "List, switch, or create customized agent profiles in the active workspace"
      def branch(profile_name = nil)
        aura_dir = ensure_workspace!

        if profile_name.nil?
          # List branches
          res = Aura::GlobalConfig.git_run(aura_dir, "branch")
          if res[:success]
            puts "Customized Agent Profiles (Branches):"
            puts "-" * 60
            puts res[:stdout]
            puts "-" * 60
          else
            puts "\e[31mFailed to list agent profiles: #{res[:stderr]}\e[0m"
          end
        else
          # Check if branch exists
          res = Aura::GlobalConfig.git_run(aura_dir, "branch", "--list", profile_name.to_s)
          exists = res[:success] && !res[:stdout].strip.empty?

          if exists
            # Switch branch
            checkout_res = Aura::GlobalConfig.git_run(aura_dir, "checkout", profile_name.to_s)
            if checkout_res[:success]
              puts "\e[32mSuccessfully switched active agent profile to '#{profile_name}'!\e[0m"
            else
              puts "\e[31mFailed to switch agent profile:\n#{checkout_res[:stderr]}\e[0m"
            end
          else
            # Prompt to create
            puts "❓ Agent profile '#{profile_name}' does not exist."
            print "   Do you want to create a new profile from the current active? (y/N): "
            $stdout.flush
            begin
              tty = File.open("/dev/tty", "r")
              confirm = tty.gets.strip
              tty.close
            rescue StandardError
              confirm = $stdin.gets&.strip || "n"
            end

            if confirm =~ /\A(y|yes)\z/i
              # Create and checkout branch
              create_res = Aura::GlobalConfig.git_run(aura_dir, "checkout", "-b", profile_name.to_s)
              if create_res[:success]
                puts "\e[32mSuccessfully created and switched to new agent profile '#{profile_name}'!\e[0m"
              else
                puts "\e[31mFailed to create agent profile:\n#{create_res[:stderr]}\e[0m"
              end
            else
              puts "Cancelled."
            end
          end
        end
      end

      private

      def find_aura_dir
        Aura.find_aura_dir(Dir.pwd)
      end

      def ensure_workspace!
        aura_dir = find_aura_dir
        if aura_dir.nil?
          puts "\e[31m⛔️ Error: Not in an Aura workspace (no .aura folder found in parent directories).\e[0m"
          puts "To initialize a workspace in the current directory, run:"
          puts "  $ aura new"
          exit 1
        end
        aura_dir
      end
    end
  end
end
