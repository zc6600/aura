# frozen_string_literal: true

require "thor"
require "aura/context/session_manager"

module Aura
  module Commands
    class SessionCommand < Thor
      desc "list", "List all sessions"
      def list
        session_mgr = Aura::Context::SessionManager.new(Dir.pwd)
        sessions = session_mgr.list
        current = session_mgr.current_name

        if sessions.empty?
          puts "No sessions found. Create one with: aura session create <name>"
          return
        end

        puts "Sessions:"
        sessions.each do |s|
          marker = s[:name] == current ? " → " : "   "
          events = s[:event_count] || 0
          last_active = s[:last_active_at] ? Time.parse(s[:last_active_at]).strftime("%Y-%m-%d %H:%M") : "never"
          puts "#{marker}#{s[:name].to_s.ljust(30)} #{events.to_s.rjust(5)} events  (last: #{last_active})"
        end
        puts
        puts "Total: #{sessions.size} session(s)"
      end

      desc "create NAME", "Create a new session"
      def create(name)
        session_mgr = Aura::Context::SessionManager.new(Dir.pwd)
        
        if session_mgr.exists?(name)
          puts "\e[31m⛔️ Error: Session '#{name}' already exists\e[0m"
          puts "Use 'aura session switch #{name}' to activate it"
          exit 1
        end

        session = session_mgr.create(name)
        puts "\e[32m✓ Created session: #{name}\e[0m"
        puts "  Database: #{session[:db_path]}"
        
        # Auto-activate the new session
        session_mgr.activate(name)
        puts "\e[32m✓ Activated session: #{name}\e[0m"
      end

      desc "switch NAME", "Switch to a session"
      def switch(name)
        session_mgr = Aura::Context::SessionManager.new(Dir.pwd)
        
        unless session_mgr.exists?(name)
          puts "\e[31m⛔️ Error: Session '#{name}' does not exist\e[0m"
          puts "Available sessions:"
          session_mgr.list.each { |s| puts "  - #{s[:name]}" }
          exit 1
        end

        session_mgr.activate(name)
        puts "\e[32m✓ Switched to session: #{name}\e[0m"
        puts "  Database: #{session_mgr.current_db_path}"
      end

      desc "delete NAME", "Delete a session"
      def delete(name)
        session_mgr = Aura::Context::SessionManager.new(Dir.pwd)
        current = session_mgr.current_name

        unless session_mgr.exists?(name)
          puts "\e[31m⛔️ Error: Session '#{name}' does not exist\e[0m"
          exit 1
        end

        # Don't allow deleting current session
        if name == current
          puts "\e[31m⛔️ Error: Cannot delete the currently active session\e[0m"
          puts "Switch to another session first: aura session switch <name>"
          exit 1
        end

        # Confirm deletion
        print "Are you sure you want to delete session '#{name}'? [y/N] "
        answer = $stdin.gets&.strip&.downcase
        unless %w[y yes].include?(answer)
          puts "Cancelled."
          return
        end

        session_mgr.delete(name)
        puts "\e[32m✓ Deleted session: #{name}\e[0m"
      end

      desc "duplicate SOURCE NEW_NAME", "Duplicate a session (for branching experiments)"
      def duplicate(source, new_name)
        session_mgr = Aura::Context::SessionManager.new(Dir.pwd)
        
        unless session_mgr.exists?(source)
          puts "\e[31m⛔️ Error: Source session '#{source}' does not exist\e[0m"
          exit 1
        end

        if session_mgr.exists?(new_name)
          puts "\e[31m⛔️ Error: Session '#{new_name}' already exists\e[0m"
          exit 1
        end

        session_mgr.duplicate(source, new_name)
        puts "\e[32m✓ Duplicated '#{source}' to '#{new_name}'\e[0m"
      end

      desc "export NAME PATH", "Export a session to a backup file"
      def export(name, dest_path)
        session_mgr = Aura::Context::SessionManager.new(Dir.pwd)
        
        unless session_mgr.exists?(name)
          puts "\e[31m⛔️ Error: Session '#{name}' does not exist\e[0m"
          exit 1
        end

        session_mgr.export(name, dest_path)
        puts "\e[32m✓ Exported session '#{name}' to: #{dest_path}\e[0m"
      end

      desc "import PATH NAME", "Import a session from a backup file"
      def import(source_path, name)
        session_mgr = Aura::Context::SessionManager.new(Dir.pwd)
        
        unless File.exist?(source_path)
          puts "\e[31m⛔️ Error: Source file '#{source_path}' does not exist\e[0m"
          exit 1
        end

        if session_mgr.exists?(name)
          puts "\e[31m⛔️ Error: Session '#{name}' already exists\e[0m"
          exit 1
        end

        session_mgr.import(source_path, name)
        puts "\e[32m✓ Imported session '#{name}' from: #{source_path}\e[0m"
      end

      desc "rename OLD_NAME NEW_NAME", "Rename a session"
      def rename(old_name, new_name)
        session_mgr = Aura::Context::SessionManager.new(Dir.pwd)
        
        unless session_mgr.exists?(old_name)
          puts "\e[31m⛔️ Error: Session '#{old_name}' does not exist\e[0m"
          exit 1
        end

        session_mgr.rename(old_name, new_name)
        puts "\e[32m✓ Renamed session: '#{old_name}' → '#{new_name}'\e[0m"
      end

      desc "current", "Show the current active session"
      def current
        session_mgr = Aura::Context::SessionManager.new(Dir.pwd)
        current_name = session_mgr.current_name
        
        if current_name
          puts "Current session: #{current_name}"
          puts "Database: #{session_mgr.current_db_path}"
        else
          puts "No active session. Using default."
        end
      end

      # Make session command available as just "aura session"
      default_task :list
    end
  end
end
