# frozen_string_literal: true

require "thor"
require "aura/commands/tools_command"
require "aura/commands/kernel_command"

module Aura
  VERSION = "0.1.0"
  module Commands
    class ApplicationCommand < Thor
      desc "new APP_PATH [options]", "Create a new Aura application"
      method_option :pretend, type: :boolean, aliases: "-p", default: nil, desc: "Run but do not make any changes"
      method_option :force,   type: :boolean, aliases: "-f", default: nil, desc: "Overwrite files that already exist"
      def new(app_path)
        require "aura/generators/aura/app/app_generator"
        opts = options.to_h.transform_keys(&:to_sym)
        gen  = Aura::Generators::AppGenerator.new([app_path], opts, {})
        gen.invoke_all
      end

      desc "version", "Show Aura version"
      def version
        puts "Aura #{Aura::VERSION}"
      end

      desc "doctor", "Run environment checks"
      def doctor
        ruby_ver = RUBY_VERSION
        puts "Ruby: #{ruby_ver}"
        puts "Aura CLI: OK"
      end

      desc "context PROJECT_PATH", "Compile and print project context"
      def context(project_path)
        require "aura/context"
        out = Aura::Context.assemble(File.expand_path(project_path), nil)
        puts out
      end

      desc "tools SUBCOMMAND ...", "Tools management commands"
      subcommand "tools", Aura::Commands::ToolsCommand

      desc "kernel SUBCOMMAND ...", "Kernel commands"
      subcommand "kernel", Aura::Commands::KernelCommand
    end
  end
end
