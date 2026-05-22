# frozen_string_literal: true

require "thor"

module Aura
  module Commands
    class BranchCommand < Thor
      def self.exit_on_failure?
        true
      end

      desc "[PROFILE_NAME]", "List, switch, or create customized agent profiles in the active workspace"
      def branch(profile_name = nil)
        aura_dir = ensure_workspace!

        if profile_name.nil?
          list_branches(aura_dir)
        else
          switch_or_create_branch(aura_dir, profile_name)
        end
      end

      private

      def list_branches(aura_dir)
        res = Aura::GlobalConfig.git_run(aura_dir, "branch")
        if res[:success]
          puts "Customized Agent Profiles (Branches):"
          puts "-" * 60
          puts res[:stdout]
          puts "-" * 60
        else
          puts "\e[31mFailed to list agent profiles: #{res[:stderr]}\e[0m"
        end
      end

      def switch_or_create_branch(aura_dir, profile_name)
        res = Aura::GlobalConfig.git_run(aura_dir, "branch", "--list", profile_name.to_s)
        exists = res[:success] && !res[:stdout].strip.empty?

        if exists
          switch_branch(aura_dir, profile_name)
        else
          prompt_create_branch(aura_dir, profile_name)
        end
      end

      def switch_branch(aura_dir, profile_name)
        checkout_res = Aura::GlobalConfig.git_run(aura_dir, "checkout", profile_name.to_s)
        if checkout_res[:success]
          puts "\e[32mSuccessfully switched active agent profile to '#{profile_name}'!\e[0m"
        else
          puts "\e[31mFailed to switch agent profile:\n#{checkout_res[:stderr]}\e[0m"
        end
      end

      def prompt_create_branch(aura_dir, profile_name)
        puts "❓ Agent profile '#{profile_name}' does not exist."
        print "   Do you want to create a new profile from the current active? (y/N): "
        $stdout.flush
        
        confirm = get_user_input

        if confirm =~ /\A(y|yes)\z/i
          create_branch(aura_dir, profile_name)
        else
          puts "Cancelled."
        end
      end

      def create_branch(aura_dir, profile_name)
        create_res = Aura::GlobalConfig.git_run(aura_dir, "checkout", "-b", profile_name.to_s)
        if create_res[:success]
          puts "\e[32mSuccessfully created and switched to new agent profile '#{profile_name}'!\e[0m"
        else
          puts "\e[31mFailed to create agent profile:\n#{create_res[:stderr]}\e[0m"
        end
      end

      def get_user_input
        begin
          tty = File.open("/dev/tty", "r")
          confirm = tty.gets.strip
          tty.close
          confirm
        rescue StandardError
          $stdin.gets&.strip || "n"
        end
      end

      def ensure_workspace!
        aura_dir = Aura::PathResolver.find_aura_dir(Dir.pwd)
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
