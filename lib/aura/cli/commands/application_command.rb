# frozen_string_literal: true

require "thor"
require "fileutils"
require "open3"
require "json"
require "yaml"
require "shellwords"
require "aura/cli/commands/tools_command"
require "aura/cli/commands/kernel_command"
require "aura/cli/commands/shell_command"

module Aura
  VERSION = "0.1.0"
  module Commands
    class ApplicationCommand < Thor
      def self.exit_on_failure?
        true
      end

      desc "new PROJECT_NAME", "Initialize an in-place Aura environment linked to a project name"
      def new(project_name)
        Aura.ensure_global_repo!
        
        target_dir = Dir.pwd
        hidden = File.join(target_dir, ".aura")
        
        puts "Initializing Aura workspace in-place at: #{target_dir}..."
        
        if File.exist?(hidden)
          puts "\e[31m⛔️ Error: .aura environment already exists in this folder!\e[0m"
          exit 1
        end

        # Clone global repository into hidden .aura environment
        out, err, status = Open3.capture3("git", "clone", Aura.global_repo_path, hidden)
        if status.success?
          puts "\e[32mSuccessfully cloned template repository into hidden .aura environment.\e[0m"
          
          # Configure local workspace git context
          Aura.git_run(hidden, "config", "user.name", "Aura Workspace")
          Aura.git_run(hidden, "config", "user.email", "workspace@aura-os.ai")
          
          # Inject .gitignore rule in parent directory
          git_ignore_path = File.join(target_dir, ".gitignore")
          existing_rules = File.exist?(git_ignore_path) ? File.read(git_ignore_path) : ""
          unless existing_rules.include?(".aura/")
            File.write(git_ignore_path, existing_rules + "\n.aura/\n")
            puts "\e[32mInjected .gitignore rule for hidden .aura environment.\e[0m"
          end
          
          # Inject .gitignore rule inside .aura folder to ignore runtime databases
          inner_ignore_path = File.join(hidden, ".gitignore")
          inner_rules = File.exist?(inner_ignore_path) ? File.read(inner_ignore_path) : ""
          unless inner_rules.include?("state/aura.db*")
            File.write(inner_ignore_path, inner_rules + "\nstate/aura.db*\n")
          end

          # Record project name in global projects registry
          Aura.register_project!(project_name, target_dir)

          # Record project name inside the local workspace configuration
          cfg_path = File.join(hidden, "config", "config.yml")
          if File.exist?(cfg_path)
            begin
              cfg = YAML.load_file(cfg_path) || {}
              cfg["project_name"] = project_name.to_s
              File.write(cfg_path, YAML.dump(cfg))
            rescue StandardError
            end
          end

          puts "\e[32mProject '#{project_name}' registered successfully!\e[0m"
        else
          puts "\e[31mFailed to clone global repository:\n#{err}\e[0m"
          exit 1
        end
      end

      desc "version", "Show Aura version"
      def version
        puts "Aura #{Aura::VERSION}"
      end

      desc "doctor", "Run environment checks"
      def doctor
        ruby_ver = RUBY_VERSION
        puts "Ruby: #{ruby_ver}"
        
        # Check Git
        git_ver, _err, status = Open3.capture3("git", "--version")
        if status.success?
          puts "Git: #{git_ver.strip}"
        else
          puts "\e[31mGit: Not found! Please install Git for version control features.\e[0m"
        end

        # Check Global Repo
        begin
          Aura.ensure_global_repo!
          puts "Global Repository (~/.aura/repo): OK"
        rescue StandardError => e
          puts "\e[31mGlobal Repository: Failed to initialize! (#{e.message})\e[0m"
        end

        puts "Aura CLI: OK"
      end

      desc "context PROJECT_PATH", "Compile and print project context"
      def context(project_path)
        require "aura/context"
        require "aura/kernel/state"
        root = File.expand_path(project_path)
        # Decouple workspace path from environment path
        env_path = Aura.environment_path(root)
        db = Aura::Kernel::State.new(env_path)
        out = Aura::Context.assemble(root, db)
        puts out
      end

      desc "tools SUBCOMMAND ...", "Tools management commands"
      subcommand "tools", Aura::Commands::ToolsCommand

      desc "kernel SUBCOMMAND ...", "Kernel commands"
      subcommand "kernel", Aura::Commands::KernelCommand

      desc "chat PROJECT_PATH", "Start an interactive Aura chat session"
      method_option :verbose, type: :boolean, aliases: "-v", desc: "Show detailed output"
      def chat(project_path)
        Aura::Commands::ShellCommand.new.start(project_path)
      end

      desc "web PROJECT_PATH", "Start a lightweight Aura web server (events JSON & SSE)"
      method_option :port, type: :numeric, aliases: "-p", default: 9299, desc: "Port to bind"
      method_option :host, type: :string, aliases: "-h", default: "127.0.0.1", desc: "Host address"
      def web(project_path)
        require "socket"
        require "sqlite3"
        root = File.expand_path(project_path)
        env_path = Aura.environment_path(root)
        
        cfg = File.join(env_path, "config", "config.yml")
        db_path = File.join(env_path, "state", "aura.db")
        if File.exist?(cfg)
          begin
            data = YAML.load_file(cfg)
            p = data.dig("state_management", "db_path")
            if p && !p.to_s.empty?
              db_path = File.expand_path(p, env_path)
            end
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
              html = "<!doctype html><meta charset=\"utf-8\"><title>Aura Web</title><pre id=log style=\"white-space:pre-wrap;background:#111;color:#eee;padding:12px;border-radius:6px;height:50vh;overflow:auto;margin:20px;\"></pre><script>var s=new EventSource('/sse');s.onmessage=function(e){var l=document.getElementById('log');l.textContent+=e.data+'\n';l.scrollTop=l.scrollHeight;};</script>"
              resp = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: #{html.bytesize}\r\n\r\n#{html}"
              socket.write(resp)
            end
          ensure
            socket.close unless path == "/sse"
          end
        end
        server.close
      end

      # --- Git-based Version Control Subcommands ---

      desc "add PATHS...", "Stage files inside the local Aura environment"
      def add(*paths)
        aura_dir = find_aura_dir
        if aura_dir.nil?
          puts "\e[31m⛔️ Error: Not an Aura workspace: .aura folder not found in this or parent directories.\e[0m"
          exit 1
        end
        
        require "pathname"
        resolved_paths = paths.map do |p|
          abs_p = File.expand_path(p)
          if abs_p.start_with?(aura_dir)
            Pathname.new(abs_p).relative_path_from(Pathname.new(aura_dir)).to_s
          else
            p
          end
        end

        res = Aura.git_run(aura_dir, "add", *resolved_paths)
        if res[:success]
          puts "\e[32mSuccessfully staged changes inside .aura.\e[0m"
        else
          puts "\e[31mError staging changes:\n#{res[:stderr]}\e[0m"
        end
      end

      desc "commit", "Commit staged changes inside the local Aura environment"
      method_option :message, type: :string, aliases: "-m", required: true, desc: "Commit message"
      def commit
        aura_dir = find_aura_dir
        if aura_dir.nil?
          puts "\e[31m⛔️ Error: Not an Aura workspace.\e[0m"
          exit 1
        end
        msg = options[:message] || options["message"]
        res = Aura.git_run(aura_dir, "commit", "-m", msg.to_s)
        if res[:success]
          puts "\e[32mSuccessfully committed changes inside .aura:\e[0m"
          puts res[:stdout]
        else
          puts "\e[31mError committing changes:\n#{res[:stderr]}\e[0m"
        end
      end

      desc "sync", "Push local workspace changes back to the global template repository"
      def sync
        aura_dir = find_aura_dir
        if aura_dir.nil?
          puts "\e[31m⛔️ Error: Not an Aura workspace.\e[0m"
          exit 1
        end
        puts "Syncing changes back to the global repository (~/.aura/repo)..."
        res = Aura.git_run(aura_dir, "push", "origin", "main")
        if res[:success]
          puts "\e[32mSuccessfully synced local changes to global repo!\e[0m"
        else
          puts "\e[31mError syncing changes:\n#{res[:stderr]}\e[0m"
        end
      end

      desc "pull", "Pull new templates or updates from the global repository"
      def pull
        aura_dir = find_aura_dir
        if aura_dir.nil?
          puts "\e[31m⛔️ Error: Not an Aura workspace.\e[0m"
          exit 1
        end
        puts "Pulling updates from the global repository (~/.aura/repo)..."
        res = Aura.git_run(aura_dir, "pull", "origin", "main")
        if res[:success]
          puts "\e[32mSuccessfully pulled updates from global repo!\e[0m"
          puts res[:stdout]
        else
          puts "\e[31mError pulling updates:\n#{res[:stderr]}\e[0m"
        end
      end

      desc "status", "Show what files are modified or untracked inside .aura"
      def status
        aura_dir = find_aura_dir
        if aura_dir.nil?
          puts "\e[31m⛔️ Error: Not an Aura workspace.\e[0m"
          exit 1
        end
        res = Aura.git_run(aura_dir, "status")
        puts res[:stdout]
        puts res[:stderr] unless res[:stderr].empty?
      end

      # --- Configuration Management Command ---

      desc "config [KEY] [VALUE]", "Read or write configuration settings"
      method_option :global, type: :boolean, aliases: "-g", desc: "Target the global template repository config"
      def config(key = nil, value = nil)
        is_global = options[:global] || options["global"]
        cfg_dir = if is_global
                    File.join(Aura.global_repo_path, "config")
                  else
                    aura_dir = find_aura_dir
                    if aura_dir.nil?
                      puts "\e[31m⛔️ Error: Not an Aura workspace. Use --global to target global config.\e[0m"
                      exit 1
                    end
                    File.join(aura_dir, "config")
                  end
        
        cfg_path = File.join(cfg_dir, "config.yml")
        FileUtils.mkdir_p(cfg_dir) unless File.directory?(cfg_dir)
        
        hash = File.exist?(cfg_path) ? (YAML.load_file(cfg_path) || {}) : {}
        
        if key.nil?
          # List all config
          puts YAML.dump(hash)
        elsif value.nil?
          # Read a single key
          val = get_hash_value(hash, key)
          if val.nil?
            puts "\e[33m(nil)\e[0m"
          else
            puts val
          end
        else
          set_hash_value(hash, key, value)
          File.write(cfg_path, YAML.dump(hash))
          is_global = options[:global] || options["global"]
          puts "\e[32mSuccessfully updated #{key} to #{value} in #{is_global ? 'global' : 'local'} config.\e[0m"
        end
      end

      desc "ask QUESTION", "Directly ask the LLM a question without any Aura OS context wrapping"
      method_option :model, type: :string, desc: "Override model name"
      method_option :provider, type: :string, desc: "Override provider name (local, openai, openrouter)"
      method_option :system, type: :string, desc: "System prompt instructions"
      def ask(question)
        require "aura/llm/client"
        require "aura/llm/env"
        
        # Load configuration (checking active .aura workspace config first, then global config)
        aura_dir = find_aura_dir
        cfg_path = if aura_dir
                     File.join(aura_dir, "config", "config.yml")
                   else
                     File.join(Aura.global_repo_path, "config", "config.yml")
                   end
        
        cfg = File.exist?(cfg_path) ? (YAML.load_file(cfg_path) || {}) : {}
        
        # Determine provider, api_base, model, temperature
        provider = options[:provider] || options["provider"] || cfg.dig("llm", "provider") || "local"
        api_base = cfg.dig("llm", "api_base")
        model = options[:model] || options["model"] || cfg.dig("llm", "model")
        temp = cfg.dig("llm", "temperature") || 0.7
        max_tokens = cfg.dig("llm", "max_tokens")
        
        # Load API keys from active workspace environment or shell environment
        if aura_dir
          Aura::LLM::Env.load_from(File.dirname(aura_dir))
        else
          Aura::LLM::Env.load_from(Dir.pwd)
        end
        Aura::LLM::Env.load_from(File.expand_path("~/.aura"))
        api_key = Aura::LLM::Env.resolve_api_key(provider)
        
        client = Aura::LLM::Client.new(provider: provider, api_base: api_base, api_key: api_key, model: model)
        
        messages = []
        system_instruction = options[:system] || options["system"]
        if system_instruction
          messages << { role: "system", content: system_instruction }
        end
        messages << { role: "user", content: question }
        
        puts "\e[34m🤖 Connecting to #{provider} (#{model || 'default model'})...\e[0m"
        puts ""
        
        # Stream response
        begin
          client.complete_stream(messages, { temperature: temp, max_tokens: max_tokens }) do |delta|
            print delta
            $stdout.flush
          end
          puts ""
        rescue StandardError => e
          puts "\n\e[31m⛔️ Error calling LLM: #{e.message}\e[0m"
        end
      end

      desc "list", "List all globally registered Aura projects and their status"
      def list
        projects = Aura.registered_projects
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
        projects = Aura.registered_projects
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
          
          if Aura.unregister_project!(project_name)
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
        aura_dir = find_aura_dir
        if aura_dir.nil?
          puts "\e[31m⛔️ Error: No .aura directory found in this workspace. Run 'aura new <name>' first.\e[0m"
          exit 1
        end

        # Register in projects registry
        Aura.register_project!(project_name, Dir.pwd)

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
        projects = Aura.registered_projects
        if projects.empty?
          puts "No projects registered."
          return
        end

        pruned_count = 0
        projects.each do |name, path|
          unless File.directory?(File.join(path, ".aura"))
            Aura.unregister_project!(name)
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
        aura_dir = find_aura_dir
        if aura_dir.nil?
          puts "\e[31m⛔️ Error: Not an Aura workspace: .aura folder not found in this or parent directories.\e[0m"
          exit 1
        end

        if profile_name.nil?
          # List branches
          res = Aura.git_run(aura_dir, "branch")
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
          res = Aura.git_run(aura_dir, "branch", "--list", profile_name.to_s)
          exists = res[:success] && !res[:stdout].strip.empty?

          if exists
            # Switch branch
            checkout_res = Aura.git_run(aura_dir, "checkout", profile_name.to_s)
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
              create_res = Aura.git_run(aura_dir, "checkout", "-b", profile_name.to_s)
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
        dir = Dir.pwd
        loop do
          hidden = File.join(dir, ".aura")
          return hidden if File.directory?(hidden)
          parent = File.dirname(dir)
          break if parent == dir
          dir = parent
        end
        nil
      end

      def get_hash_value(hash, key)
        parts = key.split(".")
        curr = hash
        parts.each do |p|
          return nil unless curr.is_a?(Hash)
          curr = curr[p] || curr[p.to_s]
        end
        curr
      end

      def set_hash_value(hash, key, value)
        parts = key.split(".")
        curr = hash
        parts[0...-1].each do |p|
          curr[p] = {} unless curr[p].is_a?(Hash)
          curr = curr[p]
        end
        
        # Parse value type
        parsed_val = if value == "true"
                       true
                     elsif value == "false"
                       false
                     elsif value =~ /\A\d+\z/
                       value.to_i
                     elsif value =~ /\A\d*\.\d+\z/
                       value.to_f
                     else
                       value
                     end
        curr[parts.last] = parsed_val
      end
    end
  end
end
